document.addEventListener('DOMContentLoaded', () => {

    let lastScannedCode = '';

    // ======================
    // Tab switching
    // ======================
   function openTab(tabName, element) {
        const tabcontent = document.getElementsByClassName("tabcontent");
        const tablinks = document.getElementsByClassName("tablink");

        for (let i = 0; i < tabcontent.length; i++) tabcontent[i].style.display = "none";
        for (let i = 0; i < tablinks.length; i++) tablinks[i].classList.remove("active");

        document.getElementById(tabName).style.display = "block";
        element.classList.add("active");


        const focusMap = {
            scan: 'barcode_input',
            search: 'bulkInput',
            database: 'searchInput'
        };

        const inputId = focusMap[tabName];

        if (inputId) {
            setTimeout(() => {
                const el = document.getElementById(inputId);
                if (el) {
                    el.focus();
                }
            }, 50); // small delay helps mobile browsers
        }


    }
    window.openTab = openTab; // expose globally

     // ===========================
    // BULK SEARCH 
    // ===========================

    const bulkInput = document.getElementById('bulkInput');
    const bulkSearchBtn = document.getElementById('bulkSearchBtn');
    const bulkDownloadBtn = document.getElementById('bulkDownloadBtn');

    bulkDownloadBtn.addEventListener("click", () => {
        window.location.href = "/download-bulk-results";
    });


    // Enable search when user types
    bulkInput.addEventListener('input', () => {
        const hasValue = bulkInput.value.trim().length > 0;
        if (hasValue) {
            bulkSearchBtn.classList.add('enabled')
            bulkSearchBtn.disabled = false
        } else {
            bulkSearchBtn.classList.remove('enabled')
            b.disabled = true
        }

    });

    // bulk search
    bulkSearchBtn.addEventListener('click', async () => {
        const codes = bulkInput.value
            .split('\n')
            .map(l => l.trim().toUpperCase())
            .filter(Boolean);

        if (!codes.length) return;

        bulkSearchBtn.disabled = true;
        bulkSearchBtn.textContent = 'Keresés...';
        bulkSearchStatus.textContent = 'Keresés...';
        bulkSearchStatus.style.color = 'blue';

        try {
            const res = await fetch('/bulk-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codes })
            });

            const data = await res.json();

            bulkTableBody.innerHTML = '';

            if (data.success && data.rows.length > 0) {
                data.rows.forEach(row => {
                    const tr = document.createElement('tr');

                    ['SKU', 'EAN-1', 'EAN-2', 'RAKTÁR', 'BOLT'].forEach(col => {
                        const td = document.createElement('td');
                        td.textContent = row[col] || '';
                        tr.appendChild(td);
                    });

                    bulkTableBody.appendChild(tr);
                });

                bulkSearchStatus.textContent = `Talált ${data.rows.length}`;
                bulkSearchStatus.style.color = 'green';
                bulkDownloadBtn.classList.add('enabled')
                bulkDownloadBtn.disabled = false;

            } else {
                bulkSearchStatus.textContent = 'Nem található rekord';
                bulkSearchStatus.style.color = 'red';
                bulkDownloadBtn.classList.remove('enabled')
                bulkDownloadBtn.disabled = true;
            }

        } catch (err) {
            console.error(err);
            bulkSearchStatus.textContent = 'A keresés sikertelen';
            bulkSearchStatus.style.color = 'red';
        }

        bulkSearchBtn.disabled = false;
        bulkSearchBtn.textContent = 'Keresés';
    });


    // ======================
    // Barcode scanner setup (Scan Tab)
    // ======================
    const barcodeInput = document.getElementById('barcode_input');
    const selectBtn = document.getElementById('select_btn');
    const processBtn = document.getElementById('process_btn');
    const scanResultTable = document.getElementById("scanResultTable");
    const scanTableBody = document.getElementById("scanTableBody");
    const scanStatus = document.getElementById("scanStatus");
    const resultBarcode = document.getElementById('resultBarcode');
    const updateBtn = document.getElementById('updateBtn');

    const popup = document.getElementById("scanPopupOverlay");
    const popupBackBtn = document.getElementById("popupBackBtn");

    popupBackBtn.addEventListener("click", () => {
        popup.classList.remove("active");
    });

    selectBtn.addEventListener('click', () => barcodeInput.focus());

    barcodeInput.addEventListener('input', () => {
        if (barcodeInput.value.trim() !== '') {
            processBtn.disabled = false;
            processBtn.classList.add('enabled');
        } else {
            processBtn.disabled = true;
            processBtn.classList.remove('enabled');
        }
    });

    barcodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && barcodeInput.value.trim() !== '') processInput();
    });

    processBtn.addEventListener('click', processInput)

async function processInput() {
        const code = barcodeInput.value.trim().toUpperCase();
        if (!code) return;

        lastScannedCode = code;
        resultBarcode.textContent = `Beolvasott Vonalkód: ${code}`;

        // Reset tables and status
        infoTableBody.innerHTML = "";
        scanTableBody.innerHTML = "";
        infoTable.style.display = "none";
        scanResultTable.style.display = "none";
        scanStatus.textContent = "Keresés...";
        scanStatus.style.color = "blue";

        try {
            // Request scan results from backend
            const res = await fetch('/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });

            const data = await res.json();

            if (data.found && data.rows && data.rows.length > 0) {

                data.rows.forEach(row => {
                    //
                    // -------------------------
                    // TABLE 1 — NON-EDITABLE
                    // -------------------------
                    //
                    const infoTr = document.createElement("tr");

                    ["SKU", "EAN1", "EAN2"].forEach(col => {
                        const td = document.createElement("td");
                        td.textContent = row[col] || "";
                        td.classList.add("non-editable");
                        infoTr.appendChild(td);
                    });

                    infoTableBody.appendChild(infoTr);

                    //
                    // -------------------------
                    // TABLE 2 — EDITABLE SHELVES
                    // -------------------------
                    //
                    const shelfTr = document.createElement("tr");

                    ["SHELF1", "SHELF2"].forEach(col => {
                        const td = document.createElement("td");

                        const editableDiv = document.createElement("div");
                        editableDiv.contentEditable = true;
                        editableDiv.classList.add("editable-cell");
                        editableDiv.textContent = row[col] || "";

                        // Enable update button only on edit
                        editableDiv.addEventListener('input', () => {
                            updateBtn.disabled = false;
                        });

                        td.appendChild(editableDiv);
                        shelfTr.appendChild(td);
                    });

                    scanTableBody.appendChild(shelfTr);
                });

                // Show both tables
                infoTable.style.display = "table";
                scanResultTable.style.display = "table";

                scanStatus.textContent = "Record(s) found";
                scanStatus.style.color = "green";

                updateBtn.disabled = true;
                updateBtn.style.display = "inline-block";


                
            } else {
                scanStatus.textContent = "Nem található rekord";
                scanStatus.style.color = "red";
            }

                // 🔥 OPEN POPUP ALWAYS
                popup.classList.add("active");

        } catch (err) {
            console.error("Hiba a beolvasásnál:", err);
            scanStatus.textContent = "Hiba a beolvasásnál";
            scanStatus.style.color = "red";
        }

        barcodeInput.value = "";
        barcodeInput.focus();
        processBtn.disabled = true;
        processBtn.classList.remove('enabled');
}


    // ======================
    // Update Master
    // ======================

    updateBtn.addEventListener('click', async () => {
        const row = scanTableBody.querySelector('tr');
        if (!row) return;

        const updatedData = {};
        const cols = ["RAKTÁR", "BOLT"]; // your editable columns

        row.querySelectorAll('.editable-cell').forEach((div, index) => {
            updatedData[cols[index]] = div.textContent.trim();
        });

        // Send to backend with only the scanned code
        try {
            const res = await fetch('/update-master', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: lastScannedCode, // the scanned code
                    updates: updatedData
                })
            });

            const data = await res.json();
            if (data.success) {
                scanStatus.textContent = "A felvétel sikeresen frissítve!"
                updateBtn.disabled = true; // disable until further edits
            } else {
                scanStatus.textContent = "A frissítés nem sikerült!"
            }
        } catch (err) {
            console.error(err);
        }
    });


    // ======================
    // CSV Upload
    // ======================
    const fileInput = document.getElementById('csvFileInput');
    const uploadStatus = document.getElementById('uploadStatus');

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;

        uploadStatus.innerHTML = `<span style="color:blue">Feltöltés ${file.name}...</span>`;

        try {
            const formData = new FormData();
            formData.append('csv', file);

            const response = await fetch('/upload-csv', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            uploadStatus.innerHTML = `<span style="color:green">${data.message} (${data.filename})</span>`;

            loadTotalRecords();

        } catch (err) {
            console.error(err);
            uploadStatus.innerHTML = `<span style="color:red">A feltöltés sikertelen!</span>`;
        } finally {
            fileInput.value = '';
        }
    });

    // =========================
    // Master Table / Search Tab
    // =========================
    const searchBtn = document.getElementById("searchBtn");
    const searchInput = document.getElementById("searchInput");
    const searchStatusLabel = document.getElementById("searchStatus");
    const masterTableBody = document.getElementById("tableBody");

    searchBtn.addEventListener("click", async () => {
        const query = searchInput.value.trim();
        if (!query) return;

        const type = document.querySelector('input[name="searchType"]:checked').value;

        searchStatusLabel.textContent = "Keresés...";
        searchStatusLabel.className = "status-label status-searching";

        try {
            const res = await fetch(`/search-master?type=${type}&query=${query}`);
            const json = await res.json();
            const data = json.data;

            masterTableBody.innerHTML = "";

            if (!data || data.length === 0) {
                searchStatusLabel.textContent = "Nem található rekord";
                searchStatusLabel.className = "status-label status-notfound";
                masterTableBody.innerHTML = "<tr><td colspan='5'>Nincs egyező adat</td></tr>";
                return;
            }

            searchStatusLabel.textContent = "Feljegyzés található";
            searchStatusLabel.className = "status-label status-found";

            data.forEach(row => {

                const tr = document.createElement("tr");
                ["SKU", "EAN-1", "EAN-2", "RAKTÁR", "BOLT"].forEach(col => {
                    const td = document.createElement("td");
                    td.textContent = row[col] || '';
                    tr.appendChild(td);
                });
                masterTableBody.appendChild(tr);
            });

        } catch (err) {
            console.error(err);
            searchStatusLabel.textContent = "Hiba a keresés során";
            searchStatusLabel.className = "status-label status-notfound";
        }
    });

    // =========================
    // Total records
    // =========================
    async function loadTotalRecords() {
        try {
            const res = await fetch("/total-records");
            const data = await res.json();

            document.getElementById("totalRecords").textContent = `Összes Rekord: ${data.total}`;

            const exportBtn = document.getElementById("exportBtn");
            if (data.total > 0) {
                exportBtn.disabled = false;
                exportBtn.classList.remove("disabled"); // optional if you have a CSS class for disabled state
            } else {
                exportBtn.disabled = true;
                exportBtn.classList.add("disabled"); // optional
            }

        } catch (err) {
            console.error("Nem sikerült betölteni az összes rekordot:", err);
        }
    }

    loadTotalRecords();

    // =========================
    // Export / Download
    // =========================
    const downloadBtn = document.getElementById("exportBtn");
    downloadBtn.addEventListener("click", () => {
        window.location.href = "/download-master";
    });

    // =========================
    // Autofocus barcode input
    // =========================
    barcodeInput.focus();

});







