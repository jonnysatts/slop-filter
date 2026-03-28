"""Persistence abstraction for Slop Filter.

Two implementations:
- LocalStore: JSON-on-disk, current default, zero dependencies.
- SupabaseStore: Postgres via Supabase, activated when SUPABASE_URL is set.

The engine calls store methods; the store handles where data lives.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
import zipfile
from abc import ABC, abstractmethod
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Abstract interface
# ---------------------------------------------------------------------------

class Store(ABC):

    # -- Voice packs --------------------------------------------------------

    @abstractmethod
    def load_voice_packs(self) -> dict[str, dict]:
        """Return all voice packs keyed by id."""

    @abstractmethod
    def save_voice_pack(self, pack: dict) -> None:
        """Persist a single voice pack."""

    # -- Batches ------------------------------------------------------------

    @abstractmethod
    def load_batches(self) -> tuple[dict[str, dict], dict[str, str]]:
        """Return (batches_by_id, doc_id_to_batch_id)."""

    @abstractmethod
    def save_batch(self, batch: dict) -> None:
        """Persist a full batch (including its documents)."""

    # -- Artifacts and exports ----------------------------------------------

    @abstractmethod
    def write_artifact(self, batch_id: str, relative_path: str, content: bytes) -> None:
        """Write an artifact file (revised text, diff HTML, report)."""

    @abstractmethod
    def build_export_zip(self, batch_id: str) -> Path:
        """Build and return the path to an export zip for a batch."""

    # -- Slop checks (portable endpoint logging) ----------------------------

    @abstractmethod
    def record_slop_check(self, check: dict) -> None:
        """Record a portable slop-check call for attribution and audit."""

    # -- API client lookup --------------------------------------------------

    @abstractmethod
    def lookup_api_client(self, raw_key: str) -> dict | None:
        """Look up an API client by raw key. Returns client dict or None."""


# ---------------------------------------------------------------------------
# Local disk implementation
# ---------------------------------------------------------------------------

class LocalStore(Store):
    """JSON-on-disk storage. Zero external dependencies."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.batch_dir = data_dir / "batches"
        self.voice_pack_dir = data_dir / "voice-packs"
        self.checks_dir = data_dir / "checks"
        self._ensure_dirs()

    def _ensure_dirs(self) -> None:
        self.data_dir.mkdir(exist_ok=True, parents=True)
        self.batch_dir.mkdir(exist_ok=True)
        self.voice_pack_dir.mkdir(exist_ok=True)
        self.checks_dir.mkdir(exist_ok=True)

    @staticmethod
    def _read_json(path: Path, default: Any = None) -> Any:
        if not path.exists():
            return default
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _write_json(path: Path, payload: Any) -> None:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # -- Voice packs --------------------------------------------------------

    def load_voice_packs(self) -> dict[str, dict]:
        packs: dict[str, dict] = {}
        for fp in self.voice_pack_dir.glob("*.json"):
            payload = self._read_json(fp, {})
            if payload:
                packs[payload["id"]] = payload
        return packs

    def save_voice_pack(self, pack: dict) -> None:
        self._write_json(self.voice_pack_dir / f"{pack['id']}.json", pack)

    # -- Batches ------------------------------------------------------------

    def load_batches(self) -> tuple[dict[str, dict], dict[str, str]]:
        batches: dict[str, dict] = {}
        doc_index: dict[str, str] = {}
        for fp in self.batch_dir.glob("*/manifest.json"):
            payload = self._read_json(fp, {})
            if not payload:
                continue
            batches[payload["id"]] = payload
            for doc in payload.get("documents", []):
                doc_index[doc["id"]] = payload["id"]
        return batches, doc_index

    def save_batch(self, batch: dict) -> None:
        batch_path = self.batch_dir / batch["id"]
        batch_path.mkdir(exist_ok=True, parents=True)
        self._write_json(batch_path / "manifest.json", batch)

    # -- Artifacts and exports ----------------------------------------------

    def write_artifact(self, batch_id: str, relative_path: str, content: bytes) -> None:
        target = self.batch_dir / batch_id / relative_path
        target.parent.mkdir(exist_ok=True, parents=True)
        target.write_bytes(content)

    def build_export_zip(self, batch_id: str) -> Path:
        batch_path = self.batch_dir / batch_id
        zip_path = batch_path / "export.zip"
        files = [p for p in batch_path.rglob("*") if p.is_file() and p.name != "export.zip"]
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for fp in files:
                archive.write(fp, arcname=f"{batch_id}/{fp.relative_to(batch_path)}")
        return zip_path

    # -- Slop checks --------------------------------------------------------

    def record_slop_check(self, check: dict) -> None:
        check_id = check.get("id") or str(uuid.uuid4())
        self._write_json(self.checks_dir / f"{check_id}.json", check)

    # -- API client lookup --------------------------------------------------

    def lookup_api_client(self, raw_key: str) -> dict | None:
        # Local mode: no client database. Auth is env-var based only.
        return None


# ---------------------------------------------------------------------------
# Supabase implementation
# ---------------------------------------------------------------------------

class SupabaseStore(Store):
    """Supabase Postgres + Storage backend."""

    def __init__(self, url: str, service_role_key: str, storage_bucket: str = "slopfilter-exports") -> None:
        from supabase import create_client
        self.client = create_client(url, service_role_key)
        self.storage_bucket = storage_bucket
        # Keep a local temp dir for zip assembly
        self._tmp_dir = Path("/tmp/slopfilter-exports")
        self._tmp_dir.mkdir(exist_ok=True, parents=True)

    # -- Voice packs --------------------------------------------------------

    def load_voice_packs(self) -> dict[str, dict]:
        result = self.client.table("voice_packs").select("*").execute()
        packs: dict[str, dict] = {}
        for row in result.data:
            pack = self._row_to_voice_pack(row)
            packs[pack["id"]] = pack
        return packs

    def save_voice_pack(self, pack: dict) -> None:
        row = {
            "id": pack["id"],
            "name": pack["name"],
            "source": pack.get("source", "manual"),
            "sample_text": pack.get("sample_text", ""),
            "sample_size": pack.get("sample_size", 0),
            "profile": pack.get("profile", {}),
            "created_at": pack.get("created_at", utc_now()),
        }
        self.client.table("voice_packs").upsert(row).execute()

    @staticmethod
    def _row_to_voice_pack(row: dict) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "source": row.get("source", "manual"),
            "sample_text": row.get("sample_text", ""),
            "sample_size": row.get("sample_size", 0),
            "profile": row.get("profile", {}),
            "created_at": row.get("created_at", ""),
        }

    # -- Batches ------------------------------------------------------------

    def load_batches(self) -> tuple[dict[str, dict], dict[str, str]]:
        runs = self.client.table("batch_runs").select("*").execute()
        batches: dict[str, dict] = {}
        doc_index: dict[str, str] = {}

        for run_row in runs.data:
            batch_id = run_row["id"]
            docs_result = (
                self.client.table("batch_documents")
                .select("*")
                .eq("batch_run_id", batch_id)
                .order("sequence_no")
                .execute()
            )
            documents = [self._row_to_document(d) for d in docs_result.data]
            batch = self._row_to_batch(run_row, documents)
            batches[batch_id] = batch
            for doc in documents:
                doc_index[doc["id"]] = batch_id

        return batches, doc_index

    def save_batch(self, batch: dict) -> None:
        run_row = {
            "id": batch["id"],
            "name": batch["name"],
            "status": batch["status"],
            "mode": batch["mode"],
            "edit_budget": batch["edit_budget"],
            "batch_default_document_mode": batch.get("batch_default_document_mode", "fiction"),
            "house_voice_samples": batch.get("house_voice_samples", ""),
            "voice_pack_id": batch.get("voice_pack_id") or None,
            "summary": batch.get("summary", {}),
            "target_voice_profile": batch.get("target_voice_profile", {}),
            "batch_voice_profile": batch.get("batch_voice_profile", {}),
            "engine_version": batch.get("engine_version", "3.0-alpha"),
            "created_at": batch.get("created_at", utc_now()),
            "updated_at": batch.get("updated_at", utc_now()),
        }
        self.client.table("batch_runs").upsert(run_row).execute()

        for doc in batch.get("documents", []):
            doc_row = {
                "id": doc["id"],
                "batch_run_id": batch["id"],
                "sequence_no": doc.get("sequence_no", 1),
                "name": doc["name"],
                "status": doc.get("status", "queued"),
                "progress_label": doc.get("progress_label", "Queued"),
                "source_type": doc.get("source_type", "text"),
                "mode_override": doc.get("mode_override", ""),
                "applied_document_mode": doc.get("applied_document_mode", ""),
                "original_text": doc.get("original_text", ""),
                "revised_text": doc.get("revised_text", ""),
                "original_analysis": doc.get("original_analysis", {}),
                "revised_analysis": doc.get("revised_analysis", {}),
                "residue_audit": doc.get("residue_audit", {}),
                "acceptance": doc.get("acceptance", {}),
                "delta": doc.get("delta", {}),
                "voice": doc.get("voice", {}),
                "is_outlier": doc.get("is_outlier", False),
                "outlier_reason": doc.get("outlier_reason", ""),
                "review_state": doc.get("review_state", "pending"),
                "notes": doc.get("notes", ""),
                "warning": doc.get("warning", ""),
                "reruns": doc.get("reruns", 0),
                "created_at": doc.get("created_at", utc_now()),
                "updated_at": doc.get("updated_at", utc_now()),
            }
            self.client.table("batch_documents").upsert(doc_row).execute()

    @staticmethod
    def _row_to_batch(row: dict, documents: list[dict]) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "mode": row["mode"],
            "edit_budget": row["edit_budget"],
            "batch_default_document_mode": row.get("batch_default_document_mode", "fiction"),
            "house_voice_samples": row.get("house_voice_samples", ""),
            "voice_pack_id": row.get("voice_pack_id") or "",
            "created_at": row.get("created_at", ""),
            "updated_at": row.get("updated_at", ""),
            "documents": documents,
            "summary": row.get("summary", {}),
            "target_voice_profile": row.get("target_voice_profile", {}),
            "batch_voice_profile": row.get("batch_voice_profile", {}),
            "engine_version": row.get("engine_version", "3.0-alpha"),
            "events": [],
        }

    @staticmethod
    def _row_to_document(row: dict) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "sequence_no": row.get("sequence_no", 1),
            "status": row.get("status", "queued"),
            "progress_label": row.get("progress_label", "Queued"),
            "source_type": row.get("source_type", "text"),
            "mode_override": row.get("mode_override", ""),
            "applied_document_mode": row.get("applied_document_mode", ""),
            "original_text": row.get("original_text", ""),
            "revised_text": row.get("revised_text", ""),
            "original_analysis": row.get("original_analysis", {}),
            "revised_analysis": row.get("revised_analysis", {}),
            "residue_audit": row.get("residue_audit", {}),
            "acceptance": row.get("acceptance", {}),
            "delta": row.get("delta", {}),
            "voice": row.get("voice", {}),
            "is_outlier": row.get("is_outlier", False),
            "outlier_reason": row.get("outlier_reason", ""),
            "review_state": row.get("review_state", "pending"),
            "notes": row.get("notes", ""),
            "warning": row.get("warning", ""),
            "reruns": row.get("reruns", 0),
            "change_count": 0,
            "quality_delta": 0,
            "detector_risk_delta": 0,
            "voice_similarity_score": 0,
            "created_at": row.get("created_at", ""),
            "updated_at": row.get("updated_at", ""),
        }

    # -- Artifacts and exports ----------------------------------------------

    def write_artifact(self, batch_id: str, relative_path: str, content: bytes) -> None:
        storage_path = f"{batch_id}/{relative_path}"
        self.client.storage.from_(self.storage_bucket).upload(
            storage_path, content, {"content-type": "application/octet-stream", "upsert": "true"}
        )

    def build_export_zip(self, batch_id: str) -> Path:
        # List files in storage under this batch prefix
        files = self.client.storage.from_(self.storage_bucket).list(batch_id)
        zip_path = self._tmp_dir / f"{batch_id}-export.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file_obj in files:
                name = file_obj.get("name", "")
                if not name:
                    continue
                storage_path = f"{batch_id}/{name}"
                data = self.client.storage.from_(self.storage_bucket).download(storage_path)
                archive.writestr(f"{batch_id}/{name}", data)
        return zip_path

    # -- Slop checks --------------------------------------------------------

    def record_slop_check(self, check: dict) -> None:
        row = {
            "id": check.get("id", str(uuid.uuid4())),
            "api_client_id": check.get("api_client_id"),
            "source_app": check.get("source_app", ""),
            "request_mode": check.get("request_mode", ""),
            "document_mode": check.get("document_mode", ""),
            "edit_budget": check.get("edit_budget", ""),
            "rewrite_enabled": check.get("rewrite_enabled", True),
            "request_payload": check.get("request_payload", {}),
            "response_payload": check.get("response_payload", {}),
            "original_quality": check.get("original_quality"),
            "revised_quality": check.get("revised_quality"),
            "quality_delta": check.get("quality_delta"),
            "original_detector_risk": check.get("original_detector_risk"),
            "revised_detector_risk": check.get("revised_detector_risk"),
            "detector_risk_delta": check.get("detector_risk_delta"),
            "voice_similarity_score": check.get("voice_similarity_score"),
            "created_at": check.get("created_at", utc_now()),
        }
        self.client.table("slop_checks").insert(row).execute()

    # -- API client lookup --------------------------------------------------

    def lookup_api_client(self, raw_key: str) -> dict | None:
        key_hash = hash_api_key(raw_key)
        result = (
            self.client.table("api_clients")
            .select("*")
            .eq("api_key_hash", key_hash)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if result.data:
            row = result.data[0]
            # Update last_used_at
            self.client.table("api_clients").update({"last_used_at": utc_now()}).eq("id", row["id"]).execute()
            return row
        return None


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_store() -> Store:
    """Create the appropriate store based on environment configuration."""
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if supabase_url and supabase_key:
        bucket = os.environ.get("SUPABASE_STORAGE_BUCKET", "slopfilter-exports").strip()
        return SupabaseStore(supabase_url, supabase_key, bucket)

    # Fall back to local disk
    data_dir_raw = os.environ.get("SLOPFILTER_DATA_DIR", "").strip()
    if data_dir_raw:
        data_dir = Path(data_dir_raw).expanduser().resolve()
    else:
        data_dir = Path(__file__).resolve().parent / ".slopfilter-data"
    return LocalStore(data_dir)
