# Contributor Guidelines

Thinking about contributing to toolbox? Awesome! We accept a variety of different types of contributions:

## Issues and Ideas

We welcome bug reports and feature requests. Please [open an issue on GitHub](https://github.com/toolbox-nxg/moderator-toolbox-nxg/issues) or post to [/r/toolbox_nxg](https://www.reddit.com/r/toolbox_nxg) for general discussion.

## Documentation

User documentation for Toolbox-NXG is published here. If you'd like to contribute to the docs, the source is in the `docs/` directory of the repository. Feel free to ask questions on [/r/toolbox_nxg](https://www.reddit.com/r/toolbox_nxg) or in a [GitHub issue](https://github.com/toolbox-nxg/moderator-toolbox-nxg/issues).

Third-party developer documentation (wiki schemas, integration guides) lives in [Schema Reference](../schema/index.md).

## Contributing Code

We review and accept pull requests for new features and bug fixes. Here's some information that will be useful for developers looking to get started:

### Code/Programming style guidelines

Since toolbox is a project that receives contributions from multiple people from various programming backgrounds, it's important to be aware of style conventions. See the [Coding Style Guide](coding-style.md) for the full guide.

### Contributing completely new functionality

We welcome new functionality, however it is always possible that someone is already working on something you have thought up or that we have not implemented something deliberately. So if you are considering coding new functionality it is always a good idea to first check. Simply [open an issue on GitHub](https://github.com/toolbox-nxg/moderator-toolbox-nxg/issues) or post to [/r/toolbox_nxg](https://www.reddit.com/r/toolbox_nxg).

### API reference and utility functions

We have a lot of utility functions in toolbox ready to be used for background operations as well as interface building. Before writing something new, check whether it already exists.

The [API Reference](api/index.md) is the primary resource — it documents all exported utilities and is generated directly from JSDoc comments in the source. You can regenerate it locally with `npm run docs:api`. Additional context:

- The [Module Architecture](module-architecture.md) guide details how the general toolbox module structure works.
- JSDoc comments alongside function definitions are the ground truth for internal APIs.
- When things are unclear, don't be afraid to ask in a GitHub issue or on the subreddit.

## Project structure

See [Project Structure](project-structure.md) for a current overview of the repository layout.

## Building and testing

See [Building and Testing](building.md) for full instructions on building the extension, running tests, and the pre-commit checklist.

## Maintainer information

Release versioning and the tagging procedure are documented in [Releasing](releasing.md).
