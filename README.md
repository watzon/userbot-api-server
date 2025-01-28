# Telegram Userbot API Server

A RESTful API server that provides HTTP endpoints to interact with Telegram using a user account (userbot). This project aims to make it easy to automate and integrate Telegram user accounts into your applications.

> [!WARNING]
> This project is under active development. Check [ROADMAP.md](ROADMAP.md) for the current implementation status and upcoming features.

## Features

- RESTful API interface for Telegram user account operations
- Support for messages, media, chat management, and user operations
- Webhook support for real-time updates
- Session management and authentication
- Comprehensive update handling for messages, edits, deletions, and more

## Installation

To install dependencies:

```bash
bun install
```

## Running the Server

To start the server:

```bash
bun start
```

## Requirements

- [Bun](https://bun.sh) v1.2.0 or later

## Project Status

This project is actively being developed. We currently support various operations including:
- Message operations (sending, forwarding, editing, pinning)
- User profile management
- Media handling
- Update processing

For a detailed view of implemented features and upcoming work, please see our [ROADMAP.md](ROADMAP.md).

## Contributing

Contributions are welcome! Please check our roadmap for areas that need work.

## License

Licensed under the MIT License. See [LICENSE](LICENSE) for details.
