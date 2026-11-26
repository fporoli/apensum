# Contributing to Apensum

Thank you for helping.\
Issues and pull requests are welcome on GitHub; for larger changes, open an issue first so we can agree on the approach.

## Before you start

- Read [CLAUDE.md](CLAUDE.md) "Rules that apply everywhere" and the file of the area you change in [docs/dev](docs/dev/): they hold the conventions every change follows (authorization in each handler, Liquibase for schema changes, texts in all four languages, Swiss formats).
- New features that are not part of the core belong in a plugin ([docs/PLUGINS.md](docs/PLUGINS.md)).
- `npm run build` and `npm test` must pass; CI also migrates and seeds a fresh database and runs the end-to-end tests.

## Contributor License Agreement

Apensum's core is offered under the GNU AGPL-3.0 and, for those who need it, under a commercial license (README "License").\
To keep that possible, every contribution to the core comes with the [Contributor License Agreement](docs/CLA.md): you keep the copyright of your work and grant the maintainer the right to distribute it under both licenses.

To agree, add this line to the description of your first pull request:

```
I have read and agree to the Apensum Contributor License Agreement (docs/CLA.md), version 1.0.
```

A contribution on behalf of an employer needs the employer's agreement too; write to us through the [contact form](https://apensum.ch/de/kontakt/) and we send the corporate version.\
Pull requests without the agreement cannot be merged.
