const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 以当前工作目录为站点根目录，数据存放在 data/ 下
const PROJECT_DIR = process.cwd();
const DATA_DIR = path.join(PROJECT_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'text-annotations.json');
const STATUS_FILE = path.join(DATA_DIR, 'status-annotations.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PROJECT_DIR));

// 初始化数据文件
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}
if (!fs.existsSync(STATUS_FILE)) fs.writeFileSync(STATUS_FILE, '[]', 'utf-8');

function readData() {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
}
function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
function readStatusData() { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); }
function writeStatusData(data) { fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2), 'utf-8'); }

// ---------- 文本注释 API ----------
app.get('/api/text-annotations', (req, res) => {
    const notes = readData();
    res.json(notes);
});

app.post('/api/text-annotations', (req, res) => {
    const { title, content } = req.body;
    if (!title && !content) {
        return res.status(400).json({ error: '标题或内容不能为空' });
    }
    const notes = readData();
    const newNote = {
        ...req.body,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: title || '无标题',
        content: content || '',
        created: new Date().toISOString()
    };
    notes.push(newNote);
    writeData(notes);
    res.status(201).json(newNote);
});

app.put('/api/text-annotations/:id', (req, res) => {
    const { id } = req.params;
    const notes = readData();
    const index = notes.findIndex(n => n.id === id);
    if (index === -1) {
        return res.status(404).json({ error: '笔记不存在' });
    }
    // 允许更新任意字段（内容、选择器、文件名等）
    Object.assign(notes[index], req.body, { id, updated: new Date().toISOString() });
    writeData(notes);
    res.json(notes[index]);
});

// 全量保存（用于卡片排序）
app.put('/api/text-annotations', (req, res) => {
    const data = req.body;
    if (!Array.isArray(data)) {
        return res.status(400).json({ error: '数据格式错误，须为数组' });
    }
    writeData(data);
    res.json(data);
});

app.delete('/api/text-annotations/:id', (req, res) => {
    const { id } = req.params;
    let notes = readData();
    notes = notes.filter(n => n.id !== id);
    writeData(notes);
    res.status(204).send();
});

// ---------- 状态注释 API ----------
app.get('/api/status-annotations', (req, res) => res.json(readStatusData()));
app.put('/api/status-annotations', (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: '数据格式错误，须为数组' });
    writeStatusData(req.body); res.json(req.body);
});
app.post('/api/status-annotations', (req, res) => {
    const item = { ...req.body, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: new Date().toISOString() };
    const data = readStatusData(); data.unshift(item); writeStatusData(data); res.status(201).json(item);
});
app.put('/api/status-annotations/:id', (req, res) => {
    const data = readStatusData(); const index = data.findIndex(item => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: '状态标注不存在' });
    Object.assign(data[index], req.body, { id: req.params.id, updated: new Date().toISOString() }); writeStatusData(data); res.json(data[index]);
});
app.delete('/api/status-annotations/:id', (req, res) => {
    writeStatusData(readStatusData().filter(item => item.id !== req.params.id)); res.status(204).send();
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Serving directory: ${PROJECT_DIR}`);
});
