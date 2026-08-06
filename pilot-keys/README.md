# Pilot Key Files

Generate a signed pilot key from this directory so the ignored private signing
key remains outside the repository history:

```powershell
Push-Location pilot-keys
node ..\scripts\generate-pilot-key.cjs "Example Club" "2026-12-31"
Pop-Location
```

For a replacement key, pass a distinct output filename as the fourth argument:

```powershell
Push-Location pilot-keys
node ..\scripts\generate-pilot-key.cjs "Example Club" "2026-12-31" "example-club-replacement-pilot-key.json"
Pop-Location
```

The generator refuses to overwrite an existing output file. Pilot key JSON
files and the private signing key are secrets: do not inspect, print, or commit
them. Loading a replacement key for the same `issuedTo` venue migrates the
newest matching local account state to the new license-derived account key and
retains the prior local account record for recovery.
