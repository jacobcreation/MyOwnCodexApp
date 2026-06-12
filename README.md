# Codex CLI GUI

An **Electron** based graphical interface that lets you:

- Browse a real filesystem workspace
- Edit files with syntax‑aware plain‑text editor
- Run an interactive terminal inside the workspace
- Chat with **Codex** to inspect, modify, or explain code in real time

---

## Features

- **File Explorer** – Open any folder, create new files/folders, and refresh the view.
- **Editor** – Simple textarea editor with automatic save handling and dirty‑state indication.
- **Integrated Terminal** – Powered by `node-pty`; supports standard shell commands.
- **Codex Chat** – Sends prompts to the `codex` CLI, streams output back, and can update the workspace based on the assistant’s suggestions.
- **Cross‑platform** – Works on macOS, Linux, and Windows (uses the platform default shell).

---

## Installation

```bash
# Clone the repository (if you haven't already)
git clone <repo-url>
cd codexclibutgui

# Install dependencies
npm install
```

> **Note:** Electron is listed as a devDependency, so a typical `npm install` pulls it in. Ensure you have a recent version of Node.js (>= 18) and npm.

---

## Running the Application

```bash
npm start
```

The app opens a window titled **Codex GUI**. By default it uses the current working directory as the workspace. Use the **Open folder** button to select a different root.

---

## Development

- **Lint / type‑check** – The project currently only uses basic JavaScript. Run `node --check *.js` to verify syntax.
- **Rebuilding Electron** – If you change the Electron version, reinstall with `npm install`.
- **Testing** – No automated tests are bundled yet; contributions are welcome.

---

## Contributing

1. Fork the repository.
2. Create a feature branch (`git checkout -b my‑feature`).
3. Make your changes.
4. Ensure the app still starts with `npm start`.
5. Open a pull request describing the changes.

---

## License

This project is released under the MIT License. See the `LICENSE` file for details.
