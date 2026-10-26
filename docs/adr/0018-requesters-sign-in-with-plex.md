# Requesters sign in with Plex, and make Requests in Kestrel's own UI

Note: this amends ADR 0004, whose Requests all came from outside Kestrel, and the Glossary's "Adding a Title or Version in Kestrel's own UI is not a Request": a Requester's ask from Kestrel's UI is one.

A household that shares its Plex server wants the people it shares with to ask for Movies and Series without running Seerr or Silo next to Kestrel. Kestrel had one login, the admin account. Now a second kind of login exists, the Requester: someone who signs in with their plex.tv account through Plex's PIN flow and whom Kestrel lets in only while that account has access to the configured Plex server. A Requester can search Titles, make a Request and follow their own Requests, and reach nothing else. Their Requests go through the same Request module as Silo's, with the source `plex` and the Plex account as the requester, so who asked is recorded the same way and the admin's Requests screen and Log show them unchanged.

Who has access is decided with the server owner's token, which the Plex plugin instance already holds for library refreshes: the owner, Plex Home members, and friends whose share includes this server. The Requester's own token is used once, to learn who they are, and never stored. An optional list of Plex users narrows who may request, and an optional Root folder per user sends their Requests elsewhere, such as a kids' folder, the way Silo's request routes do. All of it is the `plex_sign_in` section, which the Config File may declare like any other (ADR 0014).

## Considered Options

- **Keep Seerr (or Silo) in front of Kestrel.** Rejected because it is a second app to run and sign in to, Seerr speaks only the Radarr and Sonarr APIs Kestrel deliberately does not emulate (ADR 0004), and its users already have Plex accounts.
- **Local accounts for requesters, created by the admin.** Rejected because it means passwords to hand out and reset, and access drifts from who the Plex server is actually shared with.
- **Decide access with the Requester's own token (their list of servers).** Rejected because the owner's list is what the owner controls and can revoke, and it lets Kestrel re-check access later without keeping anyone's token.
- **Open the Plex auth page in a popup.** Rejected because an installed PWA on a phone has no popups to speak of. The browser goes to Plex and Plex sends it back; the PIN is bound to that browser by a short-lived HttpOnly cookie, so a PIN someone else authorised can't sign anyone in.
- **Let Requesters choose the Slot or Profile.** Rejected for now: a Requester's Request asks for the Standard Slot under Profile resolution, the defaults a new Title gets. 4K stays the admin's choice.

## Consequences

- Sessions carry who they belong to: the admin, or a Requester (their Plex account id and name). Every API route a Requester's session may call is listed; everything else answers `403 forbidden`. The API key and header login stay the admin's.
- A Requester's session is re-checked against the owner's list at most once an hour while it is used, and ends when the account lost access, when it is no longer on the list of users, or when Plex sign-in is switched off. A plex.tv outage does not end sessions.
- Changing the admin password ends the other admin sessions only; Log out everywhere still ends every session, Requesters' included.
- A Requester's Request for the same Title again returns their stored Request; another Requester asking for it adds their own Request, accepted unchanged when the Version exists.
- Kestrel talks to plex.tv: to create and read PINs, to learn a Requester's account, and to read the owner's shared users. It identifies itself with a client identifier generated once per instance.
