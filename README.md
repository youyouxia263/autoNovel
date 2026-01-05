
# DreamWeaver Novelist (小说生成器)

<img width="3075" height="1679" alt="image" src="https://github.com/user-attachments/assets/a240dc0e-dc14-4687-8287-9d78499f0871" />

<img width="1661" height="516" alt="image" src="https://github.com/user-attachments/assets/c1f37434-e672-4779-8f28-d4f0d6a286db" />
<img width="2715" height="1706" alt="image" src="https://github.com/user-attachments/assets/a0a3e9cc-22f3-46ef-8665-6ad0c1c9d7dd" />
<img width="1224" height="741" alt="image" src="https://github.com/user-attachments/assets/80440b2a-f25e-4676-a6dc-36dfc19a0522" />


An AI-powered novel generation assistant specializing in suspense and romance genres. Generates outlines, characters, and writes chapters with customizable styling.

## Features

*   **Outline Generation**: Automatically create chapter-by-chapter outlines based on a premise.
*   **Character Management**: Generate and maintain consistent character profiles.
*   **Chapter Writing**: AI-assisted writing with streaming output.
*   **Consistency Checks**: Analyze and fix plot/character inconsistencies.
*   **Multi-Model Support**: Supports Google Gemini, Alibaba Qwen, and OpenAI-compatible APIs.

## Setup & Installation

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Environment Variables**
    Create a `.env` file in the root directory and add your API key:
    ```env
    API_KEY=your_google_gemini_api_key
    ```

3.  **Run Development Server**
    ```bash
    npm start
    ```

## Database Configuration

The application supports two persistence modes configurable via the **Settings > Persistence (持久化存储)** menu.

### 1. Local Database (SQLite)
*   **Default Mode**: For the web version, this uses `IndexedDB` to simulate a local SQLite database in your browser. No setup required.
*   **Native Mode**: To use a real `SQLite` file (e.g., `novel_db.sqlite`), you must run this application with a backend adapter (Node.js/Python) that supports the SQLite driver.

### 2. Remote Database (MySQL)
To use a centralized MySQL database:

1.  Run the initialization script `db_init.sql` on your MySQL server to create the tables.
2.  Go to **Settings > Persistence** in the app sidebar.
3.  Select **Remote Database (MySQL)**.
4.  Enter your Host, Port, User, Password, and Database name.

**Note**: Direct browser-to-MySQL connection is not possible due to security protocols. The app expects a REST/GraphQL API proxy at the host address provided, or use a backend middleware.

## Usage Guide

1.  **New Novel**: Click the "+" button in the sidebar. Enter a title and premise, or let AI generate them.
2.  **Settings**: Configure your AI model provider (Gemini/Alibaba) in the Settings menu before starting.
3.  **Generation**: Click "Generate Outline" to create the structure. Then click into specific chapters to generate content.
4.  **Export**: Export your novel to TXT or PDF via the sidebar menu.

## License
MIT
