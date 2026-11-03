package acquire

// SearchNow is searchNow for the tests: Search now, waited for.
var SearchNow = (*Service).searchNow

// SearchUpgradeNow is searchUpgradeNow for the tests: Search now's Upgrade, waited for.
var SearchUpgradeNow = (*Service).searchUpgradeNow

// UpgradeSearchable is upgradable for the tests: whether an Upgrade search has anything to look for.
var UpgradeSearchable = (*Service).upgradable

// SearchGuarded is searchGuarded for the tests: a search that coalesces with an equal one already waiting.
var SearchGuarded = (*Service).searchGuarded
