# Profiles are recipes that Kestrel backs with TRaSH profiles

A Profile is a recipe, not a copy of a TRaSH profile. It has a resolution range, a Release Family (Bluray + WEB, Remux + WEB, WEB or SQP) and a language rule. The language rule is the Primary Language, the Title's Original Language, or one named language (English, German or French). Kestrel picks the TRaSH profile that backs the recipe, per kind, from the language the rule names. A Primary-Language Profile uses the household's language, so changing the Primary Language re-backs it. An Original-Language Profile uses the English profiles, whose groups release the original audio. A named-language Profile uses that language's profiles. Kestrel bundles about forty TRaSH profiles across English, German and French; the recipe makes Remux, WEB and SQP reachable without the household choosing between `german-hd-remux-web`, `remux-web-1080p` and `french-multi-vf-hd-remux-web` itself.

A recipe is offered only where every kind it applies to has a backing profile in the language its rule names. Kestrel never backs a Primary-Language or named-language Profile with another language's profile, because the scores would favour the wrong groups. Changing the Primary Language is refused, naming the Profile, when it would leave an enabled Profile without a backing profile.

## Considered Options

- **Import a TRaSH profile as a Profile, with its language read from the file name.** Rejected for three reasons:
  - The English profiles back both an English household's Primary-Language Profiles and every household's Original-Language Profiles, so the file name cannot say which rule applies.
  - A Profile imported as `german-hd-remux-web` would stay German after the household switched to French, unlike every other Profile.
  - A German household would face every French profile, few of which suit it.
- **Only the Primary and Original language rules.** Rejected: a household with a member who watches in another of the three languages could not keep a Version for them.

## Consequences

- The mapping from recipe to TRaSH profile is Kestrel's code, not data the admin edits. A TRaSH profile Kestrel has no recipe for stays unused until a Release Family or language is added for it.
- When the Primary Language matches a named language, the named-language recipe is the same as the Primary-Language one, so it isn't offered as a second Profile.
- Recipes with no backing profile in some language aren't offered there. Today that covers SQP, which TRaSH has only for English Movies; Remux for French Series; and WEB for German. TRaSH's Anime profiles have no Release Family yet. The list changes as TRaSH adds profiles.
- The Profile overlays of ADR 0023 apply to every recipe the same way.
