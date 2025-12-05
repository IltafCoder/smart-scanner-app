const express = require("express");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const multer = require("multer");
const cors = require("cors");
const { createObjectCsvWriter } = require('csv-writer');
const { pipeline } = require("stream/promises");
const { v4: uuidv4 } = require("uuid");

const app = express();
const port = process.env.PORT || 3000;

// ========================
// Middleware
// ========================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ========================
// Ensure uploads folder exists
// ========================
// Use /tmp on Vercel (serverless), local uploads folder otherwise
const UPLOAD_FOLDER = process.env.VERCEL 
    ? '/tmp/uploads' 
    : path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_FOLDER)) fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
const MASTER_FILE = path.join(UPLOAD_FOLDER, 'masterdatabase.csv');
const MASTER_COLUMNS = ['SKU', 'EAN-1', 'EAN-2', 'SHELF-1', 'SHELF-2'];

// ========================
// Multer setup for CSV upload
// ========================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_FOLDER),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = `${uuidv4()}${ext}`;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== "text/csv" && path.extname(file.originalname).toLowerCase() !== ".csv") {
            return cb(new Error("Only CSV files are allowed"), false);
        }
        cb(null, true);
    }
});

// ========================
// Routes
// ========================

// Serve main HTML
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});



// Scan barcode endpoint (supports SKU or EAN)
app.post("/scan", (req, res) => {
    const scannedCode = req.body.code?.trim();
    if (!scannedCode) return res.status(400).json({ found: false, rows: [] });

    if (!fs.existsSync(MASTER_FILE)) {
        return res.json({ found: false, rows: [] });
    }

    const rows = [];
    fs.createReadStream(MASTER_FILE)
        .pipe(csv({ separator: ";" }))
        .on("data", row => rows.push(row))
        .on("end", () => {
            let matches = [];

            if (/^\d{12,13}$/.test(scannedCode)) {
                // Treat as EAN
                matches = rows.filter(r => r["EAN-1"] === scannedCode || r["EAN-2"] === scannedCode);
            } else {
                // Treat as SKU (case-insensitive)
                matches = rows.filter(r => r["SKU"]?.toLowerCase() === scannedCode.toLowerCase());
            }

            if (matches.length > 0) {
                res.json({
                    found: true,
                    rows: matches.map(r => ({
                        SKU: r["SKU"],
                        EAN1: r["EAN-1"],
                        EAN2: r["EAN-2"],
                        SHELF1: r["SHELF-1"],
                        SHELF2: r["SHELF-2"]
                    }))
                });
            } else {
                res.json({ found: false, rows: [] });
            }
        })
        .on("error", err => {
            console.error(err);
            res.status(500).json({ found: false, rows: [] });
        });
});



// Global error handler for Multer fileFilter
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message === "Only CSV files are allowed") {
        return res.status(400).json({ message: err.message });
    }
    next(err);
});

// ========================
// CSV Upload
// ========================
app.post("/upload-csv", upload.single("csv"), async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file uploaded" });

    // Ensure master CSV exists
    if (!fs.existsSync(MASTER_FILE)) {
        const header = MASTER_COLUMNS.join(";") + "\n";
        fs.writeFileSync(MASTER_FILE, header, "utf8");
    }

    const uploadedFilePath = file.path;

    try {
        // Read uploaded CSV
        const rows = [];
        let uploadedHeaders = [];
        await new Promise((resolve, reject) => {
            fs.createReadStream(uploadedFilePath)
                .pipe(csv({ separator: ";" }))
                .on("headers", (headers) => {
                    uploadedHeaders = headers; // save the uploaded headers order
                })
                .on("data", (data) => rows.push(data))
                .on("end", resolve)
                .on("error", reject);
        });

        // Append to master CSV using the order of MASTER_COLUMNS
        const writeStream = fs.createWriteStream(MASTER_FILE, { flags: "a" });
        rows.forEach((row) => {
            const line = MASTER_COLUMNS.map((col, index) => {
                // Use value from uploaded CSV in same column position if exists, else empty
                const uploadedCol = uploadedHeaders[index];
                return uploadedCol ? row[uploadedCol] || "" : "";
            }).join(";") + "\n";
            writeStream.write(line);
        });
        writeStream.end();

        // Delete uploaded file
        fs.unlinkSync(uploadedFilePath);

        res.json({
            message: "File uploaded!",
            filename: file.originalname
        });

    } catch (err) {
        console.error(err);
        if (fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
        res.status(500).json({ message: "Error processing CSV" });
    }
});



// Search masterdatabase
app.get("/search-master", (req, res) => {
    const { type, query } = req.query; // type = 'SKU' or 'EAN', query = search value
    if (!type || !query) return res.json({ data: [] });

    // Check if master CSV exists
    if (!fs.existsSync(MASTER_FILE)) {
        return res.json({ data: [], message: "Master database not found" });
    }

    const results = [];
    const queryLower = query.toLowerCase(); // convert query to lowercase

    fs.createReadStream(MASTER_FILE)
        .pipe(csv({ separator: ';' }))
        .on("data", row => {
            if (type === 'SKU' && row['SKU'] && row['SKU'].toLowerCase() === queryLower) {
                results.push(row);
            } else if (type === 'EAN' && (row['EAN-1'] === query || row['EAN-2'] === query)) {
                results.push(row);
            }
        })
        .on("end", () => res.json({ data: results }))
        .on("error", err => {
            console.error("Error reading master CSV:", err);
            res.status(500).json({ data: [], message: "Error reading master database" });
        });
});



// Get total records in masterdatabase.csv
app.get("/total-records", (req, res) => {
    if (!fs.existsSync(MASTER_FILE)) {
        return res.json({ total: 0 });
    }

    const rows = [];
    fs.createReadStream(MASTER_FILE)
        .pipe(csv({ separator: ";" }))
        .on("data", row => rows.push(row))
        .on("end", () => {
            res.json({ total: rows.length });
        })
        .on("error", err => {
            console.error(err);
            res.status(500).json({ total: 0 });
        });
});


// Download masterdatabase.csv
app.get("/download-master", (req, res) => {
    if (!fs.existsSync(MASTER_FILE)) {
        return res.status(404).send("Master database not found.");
    }

    res.download(MASTER_FILE, "masterdatabase.csv", err => {
        if (err) {
            console.error("Error downloading file:", err);
            res.status(500).send("Error downloading file.");
        }
    });
});


// update master table

app.post('/update-master', express.json(), (req, res) => {
    const { code, updates } = req.body;

    if (!code || !updates) return res.json({ success: false });

    const rows = [];


    fs.createReadStream(MASTER_FILE)
        .pipe(csv({ separator: ';' }))
        .on('data', row => {
            // Match the scanned code with SKU or EAN columns
            if (row['SKU'] === code || row['EAN-1'] === code || row['EAN-2'] === code) {
                Object.assign(row, updates); // apply updates
            }

            rows.push(row);
        })
        .on('end', () => {
            // Prepare headers for CSV writer
            const headers = Object.keys(rows[0]).map(h => ({ id: h, title: h }));

            const csvWriter = createObjectCsvWriter({
                path: MASTER_FILE,
                header: headers,
                fieldDelimiter: ';'
            });

            csvWriter.writeRecords(rows)
                .then(() => res.json({ success: true }))
                .catch(err => {
                    console.error('CSV write error:', err);
                    res.json({ success: false });
                });
        })
        .on('error', (err) => {
            console.error('CSV read error:', err);
            res.json({ success: false });
        });
});


// ========================
// Start server
// ========================
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}

// Export the Express app for Vercel
module.exports = app;
