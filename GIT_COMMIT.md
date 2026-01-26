# Git Commit Instrukcije

## Problem
Railway ne vidi `server/package.json` i `client/package.json` jer nisu commit-ovani u Git.

## Rešenje

Commit-uj sve fajlove:

```bash
cd C:\Users\PC\Desktop\Zinga

# Dodaj sve fajlove
git add .

# Commit
git commit -m "Add package.json files and Railway configuration"

# Push na master branch
git push origin master
```

## Proveri da li su fajlovi u Git-u

```bash
# Proveri da li su package.json fajlovi u Git-u
git ls-files | grep package.json

# Trebalo bi da vidiš:
# client/package.json
# server/package.json
# package.json
```

## Važno

- Proveri da li Railway koristi `master` branch (ne `main`)
- U Railway Settings → Source → Branch: `master`
