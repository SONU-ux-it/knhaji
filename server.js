// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = "https://api.findnearroom.com"; // VPS backend base URL

// ================== ERROR HANDLING ==================
process.on("uncaughtException", (err) => logDetailedError("Uncaught Exception", err));
process.on("unhandledRejection", (reason) => logDetailedError("Unhandled Rejection", reason));

function logDetailedError(type, err) {
  console.error(`\n===== ${type} =====`);
  if (err && err.stack) {
    const stackLines = err.stack.split("\n");
    console.error(stackLines[0]);
    const fileLine = stackLines.find(line => line.includes(".js"));
    if (fileLine) console.error("Error Location:", fileLine.trim());
  } else {
    console.error(err);
  }
  console.error("=================================================\n");
}
// ===================================================

// Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dcbysxbze",
  api_key: process.env.CLOUDINARY_API_KEY || "455511686517831",
  api_secret: process.env.CLOUDINARY_API_SECRET || "Cj7gmkaYEm4U2RpP0mtl4DW4IL0"
});

// Multer setup
const upload = multer({ dest: path.join(__dirname, "tmp_uploads/") });

// ---------- Middleware ----------
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));

// ---------- Data Storage ----------
const POSTS_FILE = path.join(__dirname, "posts.json");
const CHAT_FILE = path.join(__dirname, "roommate-chats.json");

function loadPosts() {
  if (!fs.existsSync(POSTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(POSTS_FILE, "utf-8") || "[]");
  } catch (e) {
    console.error("Error reading posts.json:", e);
    return [];
  }
}
function savePosts(posts) {
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
}
function loadChats() {
  if (!fs.existsSync(CHAT_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CHAT_FILE, "utf-8") || "{}");
  } catch (e) {
    console.error("Error reading chats file:", e);
    return {};
  }
}
function saveChats(chats) {
  fs.writeFileSync(CHAT_FILE, JSON.stringify(chats, null, 2));
}

// ensure tmp_uploads exists
const TMP_DIR = path.join(__dirname, "tmp_uploads");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Upload file to Cloudinary
async function uploadFileToCloudinary(localPath) {
  try {
    const result = await cloudinary.uploader.upload(localPath, { folder: "find_near_room" });
    fs.unlink(localPath, () => {});
    if (!result || !result.secure_url) throw new Error("Cloudinary upload failed: no URL returned");
    return result.secure_url;
  } catch (err) {
    try { fs.unlinkSync(localPath); } catch {}
    throw err;
  }
}

// ================= ROUTES =================

// 1. POST ROOM
app.post("/post-room", upload.array("photos", 12), async (req, res) => {
  try {
    const {
      name, phone, email, room_type, gender, facilities,
      deposit, available_from, location, map_link, rent_by_person
    } = req.body;

    let imageLinks = [];
    if (req.body.imageLinks) {
      try {
        imageLinks = typeof req.body.imageLinks === "string"
          ? JSON.parse(req.body.imageLinks)
          : req.body.imageLinks;
        if (!Array.isArray(imageLinks)) imageLinks = [];
      } catch {
        imageLinks = [];
      }
    }

    // Upload files to Cloudinary
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadFileToCloudinary(file.path);
        imageLinks.push(url);
      }
    }

    const newRoom = {
      id: uuidv4(),
      name: name || "",
      phone: phone || "",
      email: email || "",
      gender: gender || "",
      location: location || "",
      rent_by_person: rent_by_person || "",
      deposit: deposit || "",
      room_type: room_type || "",
      available_from: available_from || "",
      facilities: facilities || "",
      map_link: map_link || "",
      imageLinks,
      type: "room",
      timestamp: new Date().toISOString()
    };

    const posts = loadPosts();
    posts.push(newRoom);
    savePosts(posts);

    res.json({ success: true, message: "Room posted successfully", links: imageLinks, id: newRoom.id });
  } catch (error) {
    console.error("Error in /post-room:", error);
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

// 2. GET Room posts
app.get("/room-posts", (req, res) => {
  res.json(loadPosts().filter((p) => p.type === "room" && !p.hidden));
});

// 3. Roommate Post
app.post("/roommate-post", (req, res) => {
  const { name, gender, phone, email, message } = req.body;
  const newPost = { 
    id: uuidv4(), name, gender, phone, email, message, 
    replies: [], type: "roommate", timestamp: new Date().toISOString() 
  };
  const posts = loadPosts();
  posts.push(newPost);
  savePosts(posts);
  res.json({ success: true, id: newPost.id });
});

// 4. Get Roommate posts
app.get("/roommate-posts", (req, res) => {
  res.json(loadPosts().filter((p) => p.type === "roommate" && !p.hidden));
});

// 5. Roommate reply
app.post("/roommate-reply", (req, res) => {
  const { postId, senderName, senderEmail, replyMessage } = req.body;
  const posts = loadPosts();
  const post = posts.find((p) => p.id === postId);
  if (!post) return res.status(404).json({ success: false, error: "Post not found." });
  post.replies.push({ senderName, senderEmail, replyMessage, timestamp: new Date().toISOString() });
  savePosts(posts);
  res.json({ success: true });
});

// 6. Delete Roommate Post
app.delete("/roommate-delete/:id", (req, res) => {
  const { id } = req.params;
  let posts = loadPosts();
  const before = posts.length;
  posts = posts.filter((p) => p.id !== id);
  savePosts(posts);
  res.json({ success: posts.length < before });
});

// 7. Private Reply (chat)
app.post("/private-reply", (req, res) => {
  const { postId, senderName, senderEmail, message } = req.body;
  const chats = loadChats();
  if (!chats[postId]) chats[postId] = [];
  chats[postId].push({ senderName, senderEmail, message, timestamp: new Date().toISOString() });
  saveChats(chats);
  res.json({ success: true });
});
app.get("/private-reply/:postId", (req, res) => {
  res.json(loadChats()[req.params.postId] || []);
});

// 8. Edit Roommate Post
app.patch("/roommate-post/:id", (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  const posts = loadPosts();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) return res.status(404).send("Post not found");
  posts[idx].message = message;
  posts[idx].updatedAt = new Date().toISOString();
  savePosts(posts);
  res.send({ success: true });
});

// 9. Admin Login
app.post("/admin-login", (req, res) => {
  const { username, password } = req.body;
  if (username === "findnearroom" && password === "radheradhe@207") {
    res.status(200).send("Login successful");
  } else {
    res.status(401).send("Invalid credentials");
  }
});

// 10. Admin Data
app.get("/admin-data", (req, res) => {
  res.json(loadPosts().filter((p) => p.type === "room"));
});

// 11. Delete Room
app.delete("/delete-room/:index", (req, res) => {
  const { index } = req.params;
  let posts = loadPosts();
  const roomPosts = posts.filter((p) => p.type === "room");
  const roomToDelete = roomPosts[index];
  if (!roomToDelete) return res.status(404).send("Room not found");
  posts = posts.filter((p) => p.id !== roomToDelete.id);
  savePosts(posts);
  res.sendStatus(200);
});

// 12. Edit Room
app.patch("/edit-room/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const updated = req.body;
  let posts = loadPosts();
  const roomPosts = posts.filter(p => p.type === "room");
  if (index < 0 || index >= roomPosts.length) {
    return res.status(404).json({ success: false, message: "Invalid room index" });
  }
  const originalRoom = roomPosts[index];
  const postIndex = posts.findIndex(p => p.id === originalRoom.id);
  if (postIndex === -1) {
    return res.status(404).json({ success: false, message: "Room post not found" });
  }
  posts[postIndex] = { ...posts[postIndex], ...updated, timestamp: new Date().toISOString() };
  savePosts(posts);
  res.json({ success: true, message: "Room updated" });
});

// 13. Hide/Unhide Rooms
app.patch("/room-hide/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const { hidden } = req.body;
  let posts = loadPosts();
  const roomPosts = posts.filter(p => p.type === "room");
  if (index < 0 || index >= roomPosts.length) {
    return res.status(404).json({ success: false, message: "Invalid room index" });
  }
  const targetRoom = roomPosts[index];
  const realIndex = posts.findIndex(p => p.id === targetRoom.id);
  if (realIndex === -1) {
    return res.status(404).json({ success: false, message: "Room not found" });
  }
  posts[realIndex].hidden = !!hidden;
  savePosts(posts);
  res.json({ success: true, hidden: posts[realIndex].hidden });
});

// 14. Hide/Unhide Roommate
app.patch("/roommate-hide/:id", (req, res) => {
  const { id } = req.params;
  const { hidden } = req.body;
  let posts = loadPosts();
  const idx = posts.findIndex(p => p.id === id && p.type === "roommate");
  if (idx === -1) {
    return res.status(404).json({ success: false, message: "Roommate post not found" });
  }
  posts[idx].hidden = !!hidden;
  savePosts(posts);
  res.json({ success: true, hidden: posts[idx].hidden });
});

// 15. Edit Roommate (full)
app.patch("/roommate-edit/:id", (req, res) => {
  const { id } = req.params;
  const updated = req.body;
  let posts = loadPosts();
  const idx = posts.findIndex(p => p.id === id && p.type === "roommate");
  if (idx === -1) {
    return res.status(404).json({ success: false, message: "Roommate post not found" });
  }
  posts[idx] = { ...posts[idx], ...updated, updatedAt: new Date().toISOString() };
  savePosts(posts);
  res.json({ success: true });
});

// Root Route
app.get("/", (req, res) => {
  res.send("✅ Find Near Room backend is live.");
});

// Start Server
app.listen(PORT, () => {
  console.log(`✅ Backend running at ${BASE_URL}`);
});
