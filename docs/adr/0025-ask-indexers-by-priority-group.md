# Automatic searches ask Indexers by priority group

Every search used to ask every enabled Indexer in parallel. A household with one unlimited Indexer and a small-quota backup spent the backup's API hits on every search, even when the main Indexer had what was needed. Indexer Priority already existed, but only broke ties between Releases of equal Score.

Now Indexer Priority also sets the order an automatic search (the Search sweep, the Upgrade sweep, the search on add, Search now and a retry after a failed Grab) asks the Indexers in. Indexers with the same number form one group and are asked together, in parallel, as before. The groups are asked in turn, lowest number first, and a group is asked only for what the earlier ones left: the Wanted units and Upgrades for which Decide plans nothing (an acceptable Release that is not an Upgrade does not count), including the Versions whose only find was an Original Offer. For a Series the next group is asked only for the seasons of the episodes left, and its Releases count only for those episodes. An Indexer that fails, is paused or is out of budget found nothing for its group, so what it would have covered is left for the next group. A manual search and RSS still ask every enabled Indexer at once: the admin's Release list should show everything, and an RSS read costs one request per Indexer whatever it finds.

With every Indexer at the same priority, which is every install that never set one (the default is 0), there is one group and every search asks exactly what it asked before.

## Considered Options

- **A global switch: ask all Indexers at once, or one after the other.** Rejected because it is all or nothing: a household with two equal main Indexers and one backup wants the two asked together and the backup only after them. Groups give that, and "one after the other" is every Indexer at its own priority.
- **A Backup flag per Indexer**, asked only when the others found nothing. Rejected because it adds a second setting next to priority that orders the same Indexers, and it stops at two tiers. Priority groups cover the backup case (the backup gets a higher number) and any number of tiers.
- **Separate numbers for the search order and the tie-break.** Rejected because they say the same thing, which Indexer the household prefers: the Indexer asked first is the one whose Release should win a tie, and two numbers could disagree. One number sets both.

## Consequences

- The indexers host knows nothing of Decide: it lists the enabled Indexers' priorities (`Priorities`) and searches one group (`SearchGroup`) next to searching all (`Search`). The loop over groups, and what a group leaves, live in `acquire`.
- A Release from a later group never competes with one from an earlier group for a unit the earlier group covered, even when it scores higher. That is the point: the earlier group is the one the household wants to use.
- The candidate cache records which groups were asked for a Title. A retry from the cache answers from it for the groups already asked and asks only the groups that were not, when something is left for them.
- Pause Grabs does not make every group look empty: what a group leaves is judged by what would be grabbed, and Pause Grabs only stops the Grabs.
- Dragging the Indexers into an order in Settings gives each its own priority, so each is its own group and they are asked one after the other. Indexers asked together need the same number, set in the form or the Config File.
- Before this, a drag only changed tie-breaks, so an install that was ever reordered would have switched to asking its Indexers one after the other without choosing it. The upgrade sets every Indexer's priority back to 0 once (migration 00045). The tie-break order such an install had set is lost; a declared Indexer gets its priority back from the Config File.
