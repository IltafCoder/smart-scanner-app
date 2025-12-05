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
    }
    window.openTab = openTab; // expose globally

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
        const code = barcodeInput.value.trim();
        if (!code) return;

        lastScannedCode = code;
        resultBarcode.textContent = `Scanned Barcode: ${code}`;

        // Reset table and status
        scanTableBody.innerHTML = "";
        scanResultTable.style.display = "none";
        scanStatus.textContent = "Searching...";
        scanStatus.style.color = "blue";

        try {
            // Fetch scanned data from backend
            const res = await fetch('/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });

            const data = await res.json();

            if (data.found && data.rows && data.rows.length > 0) {
                // Loop over all matched rows
                data.rows.forEach(row => {
                    const tr = document.createElement("tr");

                    ["SHELF1", "SHELF2"].forEach(col => {
                        const td = document.createElement("td");

                        const editableDiv = document.createElement("div");
                        editableDiv.contentEditable = true;
                        editableDiv.classList.add("editable-cell");
                        editableDiv.textContent = row[col] || '';

                        editableDiv.addEventListener('input', () => {
                            updateBtn.disabled = false;
                        });

                        td.appendChild(editableDiv);
                        tr.appendChild(td);
                    });

                    scanTableBody.appendChild(tr);
                });

                // Show table
                scanResultTable.style.display = "table";
                scanStatus.textContent = "Record(s) found";
                scanStatus.style.color = "green";

                // Keep Update button disabled initially
                updateBtn.disabled = true;
                updateBtn.style.display = "inline-block";

            } else {
                scanStatus.textContent = "No record found";
                scanStatus.style.color = "red";
            }

        } catch (err) {
            console.error("Error scanning:", err);
            scanStatus.textContent = "Error scanning";
            scanStatus.style.color = "red";
        }

        barcodeInput.value = '';
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
        const cols = ["SHELF-1", "SHELF-2"]; // your editable columns

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
                scanStatus.textContent = "Record updated successfully!"
                updateBtn.disabled = true; // disable until further edits
            } else {
                scanStatus.textContent = "Updated failed!"
            }
        } catch (err) {
            console.error(err);
            alert('Error updating record.');
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

        uploadStatus.innerHTML = `<span style="color:blue">Uploading ${file.name}...</span>`;

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
            uploadStatus.innerHTML = `<span style="color:red">Upload failed!</span>`;
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

        searchStatusLabel.textContent = "Searching...";
        searchStatusLabel.className = "status-label status-searching";

        try {
            const res = await fetch(`/search-master?type=${type}&query=${query}`);
            const json = await res.json();
            const data = json.data;

            masterTableBody.innerHTML = "";

            if (!data || data.length === 0) {
                searchStatusLabel.textContent = "No record found";
                searchStatusLabel.className = "status-label status-notfound";
                masterTableBody.innerHTML = "<tr><td colspan='5'>No matching data</td></tr>";
                return;
            }

            searchStatusLabel.textContent = "Record found";
            searchStatusLabel.className = "status-label status-found";

            data.forEach(row => {

                const tr = document.createElement("tr");
                ["SKU", "EAN-1", "EAN-2", "SHELF-1", "SHELF-2"].forEach(col => {
                    const td = document.createElement("td");
                    td.textContent = row[col] || '';
                    tr.appendChild(td);
                });
                masterTableBody.appendChild(tr);
            });

        } catch (err) {
            console.error(err);
            searchStatusLabel.textContent = "Error searching";
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

            document.getElementById("totalRecords").textContent = `Total Records: ${data.total}`;

            const exportBtn = document.getElementById("exportBtn");
            if (data.total > 0) {
                exportBtn.disabled = false;
                exportBtn.classList.remove("disabled"); // optional if you have a CSS class for disabled state
            } else {
                exportBtn.disabled = true;
                exportBtn.classList.add("disabled"); // optional
            }

        } catch (err) {
            console.error("Failed to load total records:", err);
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
