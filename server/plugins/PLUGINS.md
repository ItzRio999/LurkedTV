# 🔌 NodeCast TV Plugin System

This directory allows you to extend the functionality of **NodeCast TV** without modifying the core source code. The server automatically detects and loads any `.js` file placed in this folder at startup.

---

## 🛠️ How It Works

The plugin loader in `server/index.js` scans this directory and expects each file to export a **initialization function**. 

When the server starts, it calls this function and passes the internal Express instance and the loaded services.

### Plugin Signature
Each plugin must follow this structure:

```javascript
/**
 * @param {Object} app - The Express application instance
 * @param {Object} services - Object containing all internal services (db, syncService, etc.)
 */
module.exports = function(app, services) {
    // Your logic here
};