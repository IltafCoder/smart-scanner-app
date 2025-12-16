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


// Scan barcode endpoint (supports SKU or EAN, incl. multiple EANs in EAN-2)
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

            // ---------- EAN scan ----------
            if (/^\d{12,13}$/.test(scannedCode)) {
                matches = rows.filter(r => {
                    const ean1 = r["EAN-1"]?.trim();
                    const ean2Raw = r["EAN-2"] || "";

                    const ean2List = ean2Raw
                        .split(/[|,;]/)     // supports | , ;
                        .map(e => e.trim())
                        .filter(Boolean);

                    return ean1 === scannedCode || ean2List.includes(scannedCode);
                });
            }
            // ---------- SKU scan (case-insensitive) ----------
            else {
                matches = rows.filter(
                    r => r["SKU"]?.toLowerCase() === scannedCode.toLowerCase()
                );
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

async function deduplicateMasterCSV() {
    if (!fs.existsSync(MASTER_FILE)) return;

    const rows = [];

    await new Promise((resolve, reject) => {
        fs.createReadStream(MASTER_FILE)
            .pipe(csv({ separator: ';' }))
            .on('data', row => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    const seenSKU = new Set();
    const seenEAN = new Set();
    const uniqueRows = [];

    for (const row of rows) {
        const sku = row['SKU']?.trim().toLowerCase();
        const ean1 = row['EAN-1']?.trim();
        const ean2List = row['EAN-2']
            ? row['EAN-2'].split(/[,\s]+/).map(e => e.trim())
            : [];

        let isDuplicate = false;

        if (sku && seenSKU.has(sku)) isDuplicate = true;
        if (ean1 && seenEAN.has(ean1)) isDuplicate = true;

        for (const ean of ean2List) {
            if (seenEAN.has(ean)) {
                isDuplicate = true;
                break;
            }
        }

        if (!isDuplicate) {
            if (sku) seenSKU.add(sku);
            if (ean1) seenEAN.add(ean1);
            ean2List.forEach(e => seenEAN.add(e));

            uniqueRows.push(row);
        }
    }

    const headers = MASTER_COLUMNS.map(h => ({ id: h, title: h }));

    const csvWriter = createObjectCsvWriter({
        path: MASTER_FILE,
        header: headers,
        fieldDelimiter: ';'
    });

    await csvWriter.writeRecords(uniqueRows);
}

// CSV Upload
app.post("/upload-csv", upload.single("csv"), async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file uploaded" });

    if (!fs.existsSync(MASTER_FILE)) {
        fs.writeFileSync(MASTER_FILE, MASTER_COLUMNS.join(";") + "\n");
    }

    const uploadedFilePath = file.path;

    try {
        const rows = [];
        let uploadedHeaders = [];

        await new Promise((resolve, reject) => {
            fs.createReadStream(uploadedFilePath)
                .pipe(csv({ separator: ";" }))
                .on("headers", h => uploadedHeaders = h)
                .on("data", d => rows.push(d))
                .on("end", resolve)
                .on("error", reject);
        });

        const writeStream = fs.createWriteStream(MASTER_FILE, { flags: "a" });

        rows.forEach(row => {
            const line = MASTER_COLUMNS.map((_, i) => {
                const col = uploadedHeaders[i];
                return col ? row[col] || "" : "";
            }).join(";") + "\n";
            writeStream.write(line);
        });

        writeStream.end();
        fs.unlinkSync(uploadedFilePath);

        // 🔥 DEDUPLICATE AFTER UPLOAD
        await deduplicateMasterCSV();

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
    const { type, query } = req.query;
    if (!type || !query) return res.json({ data: [] });

    if (!fs.existsSync(MASTER_FILE)) {
        return res.json({ data: [], message: "Master database not found" });
    }

    const results = [];
    const queryTrim = query.trim();

    fs.createReadStream(MASTER_FILE)
        .pipe(csv({ separator: ';' }))
        .on("data", row => {

            // ---------- SKU SEARCH (case-insensitive) ----------
            if (
                type === 'SKU' &&
                row['SKU'] &&
                row['SKU'].toLowerCase() === queryTrim.toLowerCase()
            ) {
                results.push(row);
            }

            // ---------- EAN SEARCH (supports multiple EANs in EAN-2) ----------
            if (type === 'EAN') {
                const ean1 = row['EAN-1']?.trim();
                const ean2Raw = row['EAN-2'] || "";

                // Split EAN-2 into multiple values
                const ean2List = ean2Raw
                    .split(/[|,;]/)          // supports | , ;
                    .map(e => e.trim())
                    .filter(Boolean);

                if (ean1 === queryTrim || ean2List.includes(queryTrim)) {
                    results.push(row);
                }
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

    const normalizedCode = code.trim().toLowerCase();
    const rows = [];
    let updated = false;

    fs.createReadStream(MASTER_FILE)
        .pipe(csv({ separator: ';' }))
        .on('data', row => {

            const sku = row['SKU']?.trim().toLowerCase();
            const ean1 = row['EAN-1']?.trim();
            const ean2List = row['EAN-2']
                ? row['EAN-2']
                    .split(/[,\s]+/)   // supports comma or space
                    .map(e => e.trim())
                : [];

            const isMatch =
                sku === normalizedCode ||
                ean1 === code ||
                ean2List.includes(code);

            if (isMatch) {
                Object.assign(row, updates);
                updated = true;
            }

            rows.push(row);
        })
        .on('end', () => {
            if (!updated) {
                return res.json({ success: false, message: "No matching record found" });
            }

            const headers = Object.keys(rows[0]).map(h => ({
                id: h,
                title: h
            }));

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
        .on('error', err => {
            console.error('CSV read error:', err);
            res.json({ success: false });
        });
});


// bulk search

app.post('/bulk-search', express.json(), (req, res) => {
    const { codes } = req.body;

    if (!Array.isArray(codes) || codes.length === 0) {
        return res.json({ success: false, rows: [] });
    }

    const searchSet = new Set(codes.map(c => c.toUpperCase()));
    const results = [];

    fs.createReadStream(MASTER_FILE)
        .pipe(csv({ separator: ';' }))
        .on('data', row => {
            const sku = (row['SKU'] || '').toUpperCase();
            const ean1 = (row['EAN-1'] || '').toUpperCase();
            const ean2Raw = (row['EAN-2'] || '').toUpperCase();

            const ean2List = ean2Raw
                .split(/[,| ]+/)
                .map(e => e.trim())
                .filter(Boolean);

            if (
                searchSet.has(sku) ||
                searchSet.has(ean1) ||
                ean2List.some(e => searchSet.has(e))
            ) {
                results.push(row);
            }
        })
        .on('end', async () => {

            if (results.length > 0) {
                const headers = Object.keys(results[0]).map(h => ({
                    id: h,
                    title: h
                }));

                const csvWriter = createObjectCsvWriter({
                    path: BULK_RESULTS_FILE,
                    header: headers,
                    fieldDelimiter: ';'
                });

                await csvWriter.writeRecords(results);
            }

            res.json({
                success: true,
                count: results.length,
                rows: results
            });
        })
        .on('error', err => {
            console.error(err);
            res.status(500).json({ success: false });
        });
});


app.get("/download-bulk-results", (req, res) => {
    if (!fs.existsSync(BULK_RESULTS_FILE)) {
        return res.status(404).send("No search results found.");
    }

    res.download(BULK_RESULTS_FILE, "search-results.csv", err => {
        if (err) {
            console.error("Error downloading file:", err);
            res.status(500).send("Error downloading file.");
        }
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






