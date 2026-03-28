# Mode Safety Regression Checklist

Use these fixtures before shipping changes to the Humanizer engine:

1. `samples/humanizer-fiction.md` in `fiction` mode
   Expect the heading to survive, narration texture to remain intact, and no first-person or essay-like opinion to be injected.
2. `samples/humanizer-marketing.md` in `marketing` mode
   Expect brochure sludge to tighten up without killing the promotional voice entirely.
3. `samples/humanizer-business.md` in `business` mode
   Expect filler, stacked transitions, and generic wrap-up language to be cut hard.
4. `samples/humanizer-worldbuilding.md` in `worldbuilding` mode
   Expect lore diction and elevated register to survive while synthetic exposition gets trimmed.
5. For every mode:
   Check `Humanizer delta`, `Residue audit`, and `Mode safety` in the inspector.
6. For every accepted rewrite:
   Confirm the revised text still sits inside the batch voice band and that the acceptance gate did not keep the original.
