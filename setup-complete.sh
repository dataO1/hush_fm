#!/bin/bash

# Silent Disco - Full Production Setup
# Sets up a complete Python environment with all dependencies

set -e

echo "🎧 Silent Disco - Production Setup"
echo "===================================="
echo ""

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Install from https://python.org"
    exit 1
fi

PY_VERSION=$(python3 --version | cut -d' ' -f2)
echo "✅ Python $PY_VERSION"

# Create project structure
echo ""
echo "📁 Creating project structure..."
mkdir -p silent-disco/{static,uploads}
cd silent-disco

# Create Python virtual environment
echo "🔧 Creating virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

# Activate virtual environment
echo "📦 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "⬆️  Upgrading pip..."
pip install --upgrade pip setuptools wheel

# Install requirements
echo "📥 Installing dependencies..."
pip install -r requirements.txt

# Create main.py
echo "📝 Creating main.py..."
cat > main.py << 'MAINEOF'
#!/usr/bin/env python3
# See python-main-server.py for full content
# Copy the entire content from provided python-main-server.py file here
MAINEOF

# Create static HTML
echo "📝 Creating static/index.html..."
mkdir -p static
cat > static/index.html << 'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎧 Silent Disco - Listener</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
    }
    h1 {
      text-align: center;
      margin-bottom: 10px;
      color: #333;
      font-size: 2em;
    }
    .subtitle {
      text-align: center;
      color: #999;
      margin-bottom: 30px;
      font-size: 0.9em;
    }
    audio {
      width: 100%;
      margin-bottom: 20px;
      outline: none;
    }
    .status {
      padding: 15px;
      border-radius: 10px;
      margin-bottom: 20px;
      text-align: center;
      font-weight: bold;
    }
    .status.connected {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .status.disconnected {
      background: #ffebee;
      color: #c62828;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 20px;
    }
    .info-item {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 10px;
      text-align: center;
    }
    .info-label {
      font-size: 0.85em;
      color: #999;
      margin-bottom: 5px;
    }
    .info-value {
      font-size: 1.5em;
      color: #333;
      font-weight: bold;
    }
    button {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 10px;
      font-size: 1em;
      cursor: pointer;
      background: #667eea;
      color: white;
      font-weight: bold;
      transition: all 0.3s;
      margin-bottom: 10px;
    }
    button:hover {
      background: #5568d3;
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
    }
    .volume-control {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 20px 0;
    }
    input[type="range"] {
      flex: 1;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎧 Silent Disco</h1>
    <p class="subtitle">Connect to the live stream</p>

    <audio id="player" controls autoplay playsinline></audio>

    <div id="status" class="status disconnected">
      Not connected
    </div>

    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Status</div>
        <div class="info-value" id="connectionStatus">—</div>
      </div>
      <div class="info-item">
        <div class="info-label">Current Song</div>
        <div class="info-value" id="songName">—</div>
      </div>
    </div>

    <div class="volume-control">
      <span>🔊</span>
      <input type="range" id="volumeControl" min="0" max="100" value="70">
      <span id="volumeValue">70%</span>
    </div>

    <button onclick="startListening()">📡 Join Silent Disco</button>
    <button onclick="stopListening()" style="background: #d32f2f;">Leave</button>
  </div>

  <script>
    // Get current audio from server
    async function startListening() {
      try {
        const response = await fetch('/audio/current');
        if (response.ok) {
          const audio = await response.json();
          const audioPath = `/uploads/${audio.filename}`;
          document.getElementById('player').src = audioPath;
          document.getElementById('songName').textContent = audio.original_name;
          document.getElementById('status').textContent = '🎵 Playing';
          document.getElementById('status').className = 'status connected';
          document.getElementById('connectionStatus').textContent = 'Connected';
        }
      } catch (error) {
        console.error('Error:', error);
        document.getElementById('status').textContent = 'Connection Error';
        document.getElementById('status').className = 'status disconnected';
      }
    }

    function stopListening() {
      document.getElementById('player').pause();
      document.getElementById('player').src = '';
      document.getElementById('status').textContent = 'Disconnected';
      document.getElementById('status').className = 'status disconnected';
      document.getElementById('connectionStatus').textContent = '—';
    }

    // Volume control
    document.getElementById('volumeControl').addEventListener('input', (e) => {
      const vol = e.target.value;
      document.getElementById('player').volume = vol / 100;
      document.getElementById('volumeValue').textContent = vol + '%';
    });

    // Auto-update current song
    setInterval(async () => {
      try {
        const response = await fetch('/audio/current');
        if (response.ok) {
          const audio = await response.json();
          document.getElementById('songName').textContent = audio.original_name;
        }
      } catch (error) {
        // Silently ignore
      }
    }, 5000);
  </script>
</body>
</html>
HTMLEOF

# Create upload UI
echo "📝 Creating static/upload.html..."
cat > static/upload.html << 'UPLOADEOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Upload - Silent Disco</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
    }
    h1 {
      text-align: center;
      margin-bottom: 30px;
      color: #333;
    }
    .upload-area {
      border: 3px dashed #667eea;
      border-radius: 10px;
      padding: 40px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s;
      margin-bottom: 20px;
    }
    .upload-area:hover {
      background: #f5f5f5;
      border-color: #764ba2;
    }
    input[type="file"] {
      display: none;
    }
    button {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 10px;
      font-size: 1em;
      cursor: pointer;
      background: #667eea;
      color: white;
      font-weight: bold;
      transition: all 0.3s;
    }
    button:hover {
      background: #5568d3;
      transform: translateY(-2px);
    }
    .status {
      margin-top: 20px;
      padding: 15px;
      border-radius: 10px;
      text-align: center;
      display: none;
    }
    .status.success {
      background: #e8f5e9;
      color: #2e7d32;
      display: block;
    }
    .status.error {
      background: #ffebee;
      color: #c62828;
      display: block;
    }
    .files-list {
      margin-top: 30px;
    }
    .file-item {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 10px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .file-info h3 {
      margin-bottom: 5px;
      color: #333;
    }
    .file-info small {
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎧 Upload MP3 - Silent Disco</h1>
    
    <div class="upload-area" onclick="document.getElementById('fileInput').click()">
      <div style="font-size: 3em; margin-bottom: 10px;">📁</div>
      <p>Click to select or drag MP3 file here</p>
      <input type="file" id="fileInput" accept=".mp3" onchange="handleFileSelect()">
    </div>

    <button onclick="uploadFile()">📤 Upload</button>
    
    <div id="status" class="status"></div>

    <div class="files-list">
      <h2>Uploaded Files</h2>
      <div id="filesList"></div>
    </div>
  </div>

  <script>
    let selectedFile = null;

    // Drag and drop
    const uploadArea = document.querySelector('.upload-area');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      uploadArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    uploadArea.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      document.getElementById('fileInput').files = files;
      handleFileSelect();
    });

    function handleFileSelect() {
      const file = document.getElementById('fileInput').files[0];
      if (file && file.type === 'audio/mpeg') {
        selectedFile = file;
        const status = document.getElementById('status');
        status.textContent = `Selected: ${file.name}`;
        status.className = 'status success';
      }
    }

    async function uploadFile() {
      if (!selectedFile) {
        showStatus('Select a file first', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('audio', selectedFile);

      try {
        const response = await fetch('/upload', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();
        if (data.success) {
          showStatus(`✅ ${data.message}`, 'success');
          selectedFile = null;
          document.getElementById('fileInput').value = '';
          loadFiles();
        } else {
          showStatus(`❌ ${data.error}`, 'error');
        }
      } catch (error) {
        showStatus(`❌ Error: ${error.message}`, 'error');
      }
    }

    function showStatus(msg, type) {
      const status = document.getElementById('status');
      status.textContent = msg;
      status.className = `status ${type}`;
    }

    async function loadFiles() {
      try {
        const response = await fetch('/audio/list');
        const data = await response.json();
        const filesList = document.getElementById('filesList');
        
        if (data.files.length === 0) {
          filesList.innerHTML = '<p style="color: #999;">No files uploaded yet</p>';
          return;
        }

        filesList.innerHTML = data.files.map(file => `
          <div class="file-item">
            <div class="file-info">
              <h3>${file.original_name}</h3>
              <small>${(file.duration || 0).toFixed(0)}s • ${file.bitrate}kbps</small>
            </div>
            <button onclick="deleteFile('${file.id}')" style="width: auto; background: #d32f2f;">Delete</button>
          </div>
        `).join('');
      } catch (error) {
        console.error('Error loading files:', error);
      }
    }

    async function deleteFile(fileId) {
      try {
        await fetch(`/audio/${fileId}`, { method: 'DELETE' });
        loadFiles();
      } catch (error) {
        console.error('Error deleting file:', error);
      }
    }

    // Load files on page load
    loadFiles();
  </script>
</body>
</html>
UPLOADEOF

# Create .env file
echo "🔧 Creating .env..."
cat > .env << 'ENVEOF'
HOST=0.0.0.0
PORT=3000
DEBUG=False
ENVEOF

# Create .gitignore
echo "📝 Creating .gitignore..."
cat > .gitignore << 'GITEOF'
venv/
__pycache__/
*.pyc
*.pyo
*.egg-info/
dist/
build/
.env
uploads/*
!uploads/.gitkeep
.DS_Store
*.log
GITEOF

# Create uploads .gitkeep
mkdir -p uploads
touch uploads/.gitkeep

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 To start the server:"
echo "   1. Activate venv: source venv/bin/activate"
echo "   2. Run server: python main.py"
echo "   3. Open browser: http://localhost:3000"
echo "   4. Upload page: http://localhost:3000/upload.html"
echo ""
echo "📱 On phone (same WiFi):"
echo "   http://<your-laptop-ip>:3000"
echo ""
