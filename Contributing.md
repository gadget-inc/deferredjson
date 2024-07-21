# Contributing

## Development environment

We require `node` and `pnpm` to exist. If you're a nix user, we have a `flake.nix` present that installs the same version of the development tools we use for everyone.

## Building TypeScript

Run `pnpm build` to build the project

## Running tests

Run `pnpm test` to run the jest tests

## Releasing

Releasing is done automatically via [our release workflow](.github/workflows/release.yml). Any commits to the main branch that change the `package.json` versions will automatically be published.

If you need to release manually for some reason you can do the following

```
pnpm publish --access=public --no-git-tag-version
```

or

```
pnpm publish --access=public --no-git-tag-version
```

to push a new version to NPM.
