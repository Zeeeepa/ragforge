"use strict";
const electron = require("electron");
const path = require("path");
const child_process = require("child_process");
const util = require("util");
const os = require("os");
const execAsync = util.promisify(child_process.exec);
const NEO4J_CONTAINER_NAME = "ragforge-neo4j";
const NEO4J_IMAGE = "neo4j:5-community";
const NEO4J_BOLT_PORT = 7687;
const NEO4J_HTTP_PORT = 7474;
class DockerManager {
  neo4jProcess = null;
  async checkDocker() {
    try {
      const { stdout } = await execAsync("docker --version");
      const version = stdout.trim();
      try {
        await execAsync("docker info");
        return { installed: true, running: true, version };
      } catch {
        return { installed: true, running: false, version, error: "Docker daemon is not running" };
      }
    } catch (err) {
      return {
        installed: false,
        running: false,
        error: "Docker is not installed"
      };
    }
  }
  getDockerInstallInstructions() {
    const os$1 = os.platform();
    switch (os$1) {
      case "darwin":
        return `
## Install Docker on macOS

1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop
2. Open the downloaded .dmg file
3. Drag Docker to Applications
4. Open Docker from Applications
5. Follow the setup wizard

Or via Homebrew:
\`\`\`
brew install --cask docker
\`\`\`
`;
      case "win32":
        return `
## Install Docker on Windows

1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop
2. Run the installer
3. Follow the setup wizard
4. Restart your computer if prompted
5. Open Docker Desktop

**Note:** WSL 2 is required. The installer will guide you through this.
`;
      case "linux":
        return `
## Install Docker on Linux

### Ubuntu/Debian:
\`\`\`bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect
\`\`\`

### Fedora:
\`\`\`bash
sudo dnf install docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
\`\`\`

### Arch Linux:
\`\`\`bash
sudo pacman -S docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
\`\`\`
`;
      default:
        return "Please visit https://docs.docker.com/get-docker/ for installation instructions.";
    }
  }
  async checkNeo4j() {
    try {
      const { stdout } = await execAsync(`docker ps -a --filter "name=${NEO4J_CONTAINER_NAME}" --format "{{.Status}}"`);
      const status = stdout.trim();
      if (!status) {
        return { containerExists: false, running: false };
      }
      const running = status.toLowerCase().startsWith("up");
      return {
        containerExists: true,
        running,
        port: NEO4J_BOLT_PORT,
        boltUrl: `bolt://localhost:${NEO4J_BOLT_PORT}`
      };
    } catch {
      return { containerExists: false, running: false };
    }
  }
  async pullNeo4jImage(onProgress) {
    return new Promise((resolve, reject) => {
      const pull = child_process.spawn("docker", ["pull", NEO4J_IMAGE]);
      pull.stdout.on("data", (data) => {
        onProgress?.(data.toString());
      });
      pull.stderr.on("data", (data) => {
        onProgress?.(data.toString());
      });
      pull.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to pull Neo4j image (exit code ${code})`));
        }
      });
    });
  }
  async createNeo4jContainer(password = "ragforge") {
    const args = [
      "run",
      "-d",
      "--name",
      NEO4J_CONTAINER_NAME,
      "-p",
      `${NEO4J_BOLT_PORT}:7687`,
      "-p",
      `${NEO4J_HTTP_PORT}:7474`,
      "-e",
      `NEO4J_AUTH=neo4j/${password}`,
      "-e",
      'NEO4J_PLUGINS=["apoc"]',
      "-e",
      "NEO4J_dbms_security_procedures_unrestricted=apoc.*",
      "--restart",
      "unless-stopped",
      NEO4J_IMAGE
    ];
    try {
      await execAsync(`docker ${args.join(" ")}`);
    } catch (err) {
      throw new Error(`Failed to create Neo4j container: ${err.message}`);
    }
  }
  async startNeo4j() {
    try {
      await execAsync(`docker start ${NEO4J_CONTAINER_NAME}`);
    } catch (err) {
      throw new Error(`Failed to start Neo4j: ${err.message}`);
    }
  }
  async stopNeo4j() {
    try {
      await execAsync(`docker stop ${NEO4J_CONTAINER_NAME}`);
    } catch (err) {
      throw new Error(`Failed to stop Neo4j: ${err.message}`);
    }
  }
  async removeNeo4jContainer() {
    try {
      await execAsync(`docker rm -f ${NEO4J_CONTAINER_NAME}`);
    } catch (err) {
      throw new Error(`Failed to remove Neo4j container: ${err.message}`);
    }
  }
  async waitForNeo4jReady(maxAttempts = 30, intervalMs = 2e3) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const { stdout } = await execAsync(
          `docker exec ${NEO4J_CONTAINER_NAME} curl -s -o /dev/null -w "%{http_code}" http://localhost:7474`
        );
        if (stdout.trim() === "200") {
          return true;
        }
      } catch {
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  }
  async ensureNeo4jRunning(onProgress) {
    const password = "ragforge";
    const dockerStatus = await this.checkDocker();
    if (!dockerStatus.installed) {
      throw new Error("DOCKER_NOT_INSTALLED");
    }
    if (!dockerStatus.running) {
      throw new Error("DOCKER_NOT_RUNNING");
    }
    const neo4jStatus = await this.checkNeo4j();
    if (!neo4jStatus.containerExists) {
      onProgress?.("Pulling Neo4j image...");
      await this.pullNeo4jImage(onProgress);
      onProgress?.("Creating Neo4j container...");
      await this.createNeo4jContainer(password);
    } else if (!neo4jStatus.running) {
      onProgress?.("Starting Neo4j...");
      await this.startNeo4j();
    }
    onProgress?.("Waiting for Neo4j to be ready...");
    const ready = await this.waitForNeo4jReady();
    if (!ready) {
      throw new Error("Neo4j failed to start within timeout");
    }
    return {
      boltUrl: `bolt://localhost:${NEO4J_BOLT_PORT}`,
      password
    };
  }
  getNeo4jConnectionInfo() {
    return {
      boltUrl: `bolt://localhost:${NEO4J_BOLT_PORT}`,
      username: "neo4j",
      password: "ragforge"
    };
  }
}
const dockerManager = new DockerManager();
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: "hiddenInset",
    show: false
  });
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
electron.ipcMain.handle("docker:check", async () => {
  return dockerManager.checkDocker();
});
electron.ipcMain.handle("docker:getInstallInstructions", () => {
  return dockerManager.getDockerInstallInstructions();
});
electron.ipcMain.handle("neo4j:check", async () => {
  return dockerManager.checkNeo4j();
});
electron.ipcMain.handle("neo4j:ensure", async (event) => {
  return dockerManager.ensureNeo4jRunning((msg) => {
    mainWindow?.webContents.send("neo4j:progress", msg);
  });
});
electron.ipcMain.handle("neo4j:start", async () => {
  await dockerManager.startNeo4j();
});
electron.ipcMain.handle("neo4j:stop", async () => {
  await dockerManager.stopNeo4j();
});
electron.ipcMain.handle("neo4j:getConnectionInfo", () => {
  return dockerManager.getNeo4jConnectionInfo();
});
electron.ipcMain.handle("shell:openExternal", async (_, url) => {
  await electron.shell.openExternal(url);
});
electron.ipcMain.handle("dialog:selectFolder", async () => {
  const result = await electron.dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});
electron.app.whenReady().then(() => {
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", async () => {
});
