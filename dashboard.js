const tableBody = document.getElementById("attendanceTableBody");
const emptyState = document.getElementById("emptyState");
const dateFilter = document.getElementById("dateFilter");
const recordCount = document.getElementById("recordCount");
const pendingUsersList = document.getElementById("pendingUsersList");
const manualStudentForm = document.getElementById("manualStudentForm");
const manualStudentMessage = document.getElementById("manualStudentMessage");
const exportButton = document.getElementById("exportButton");
const navItems = document.querySelectorAll(".nav-item");
const viewSections = document.querySelectorAll(".view-section");

navItems.forEach((button) => {
    button.addEventListener("click", () => {
        navItems.forEach((item) => item.classList.toggle("active", item === button));

        const sectionName = button.querySelector("span").textContent.trim().toLowerCase();
        viewSections.forEach((section) => {
            const isApprovalView = sectionName === "users" && section.id === "approvalsSection";
            const isOverviewView = sectionName === "overview" && section.id === "overviewSection";
            const isDashboardView = sectionName === "dashboard" && section.id === "overviewSection";
            const isAttendanceView = sectionName === "attendance records" && section.id === "overviewSection";
            section.classList.toggle("active", isApprovalView || isOverviewView || isDashboardView || isAttendanceView);
        });
    });
});

async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.message || "Request failed.");
    }

    return data;
}

function formatDate(date) {
    if (!date) return "-";
    return new Date(`${date}T00:00:00`).toLocaleDateString([], {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function getStatusMeta(status, signOutTime) {
    if (status === "absent") {
        return { label: "Absent", className: "absent" };
    }
    if (signOutTime) {
        return { label: "Signed out", className: "signed-out" };
    }
    return { label: "Present", className: "present" };
}

function renderPendingUsers(users) {
    if (!pendingUsersList) return;
    pendingUsersList.innerHTML = "";

    if (!users.length) {
        pendingUsersList.innerHTML = '<p class="empty-state visible">No pending registrations.</p>';
        return;
    }

    users.forEach((user) => {
        const card = document.createElement("div");
        card.className = "pending-user-card";
        card.innerHTML = `
            <div>
                <strong>${user.fullName}</strong>
                <small>${user.email}</small>
            </div>
            <button type="button">Approve</button>
        `;

        card.querySelector("button").addEventListener("click", async () => {
            try {
                await apiFetch(`/api/admin/users/${user.id}/approve`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                });
                await loadPendingUsers();
                await loadAttendance();
            } catch (error) {
                alert(error.message);
            }
        });

        pendingUsersList.appendChild(card);
    });
}

async function loadPendingUsers() {
    try {
        const users = await apiFetch("/api/pending-users");
        renderPendingUsers(users);
    } catch (error) {
        if (pendingUsersList) {
            pendingUsersList.innerHTML = `<p class="empty-state visible">${error.message}</p>`;
        }
    }
}

async function loadAttendance() {
    const selectedDate = dateFilter ? dateFilter.value : "";
    const records = await apiFetch(selectedDate ? `/api/attendance?date=${selectedDate}` : "/api/attendance");

    const visibleRecords = [...records].sort((a, b) => {
        return new Date(b.date) - new Date(a.date) || a.fullName.localeCompare(b.fullName);
    });

    tableBody.replaceChildren();

    visibleRecords.forEach((record) => {
        const row = document.createElement("tr");
        const statusMeta = getStatusMeta(record.status, record.signOutTime);

        [
            formatDate(record.date),
            record.fullName,
            record.signInTime || "-",
            record.signOutTime || "-",
            record.status === "absent" ? (record.note || "-") : "-"
        ].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });

        const statusCell = document.createElement("td");
        const statusElement = document.createElement("span");
        statusElement.className = `status ${statusMeta.className}`;
        statusElement.textContent = statusMeta.label;
        statusCell.appendChild(statusElement);
        row.appendChild(statusCell);

        const actionCell = document.createElement("td");
        if (record.signOutTime) {
            actionCell.textContent = "-";
        } else {
            const noteInput = document.createElement("input");
            noteInput.type = "text";
            noteInput.placeholder = "Reason";
            noteInput.value = record.note || "";
            noteInput.className = "note-input";

            const markAbsentButton = document.createElement("button");
            markAbsentButton.type = "button";
            markAbsentButton.className = "mark-absent-button";
            markAbsentButton.textContent = "Mark absent";
            markAbsentButton.addEventListener("click", async () => {
                try {
                    await apiFetch("/api/admin/mark-absent", {
                        method: "POST",
                        body: JSON.stringify({
                            userId: record.userId,
                            date: record.date,
                            note: noteInput.value,
                        }),
                    });
                    await loadAttendance();
                } catch (error) {
                    alert(error.message);
                }
            });

            actionCell.append(noteInput, markAbsentButton);
        }
        row.appendChild(actionCell);
        tableBody.appendChild(row);
    });

    const totalDays = new Set(records.map((record) => record.date)).size;
    const signedOut = records.filter((record) => record.signOutTime).length;
    const absent = records.filter((record) => record.status === "absent").length;

    document.getElementById("totalDays").textContent = totalDays;
    document.getElementById("totalRecords").textContent = records.length;
    document.getElementById("totalSignedOut").textContent = signedOut;
    document.getElementById("totalAbsent").textContent = absent;
    recordCount.textContent = `${visibleRecords.length} record${visibleRecords.length === 1 ? "" : "s"}`;
    emptyState.classList.toggle("visible", visibleRecords.length === 0);
}

if (dateFilter) {
    dateFilter.addEventListener("change", loadAttendance);
}

if (document.getElementById("refreshButton")) {
    document.getElementById("refreshButton").addEventListener("click", async () => {
        dateFilter.value = "";
        await loadPendingUsers();
        await loadAttendance();
    });
}

if (manualStudentForm) {
    manualStudentForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const payload = {
            fullName: document.getElementById("manualFullName").value.trim(),
            email: document.getElementById("manualEmail").value.trim(),
            code: document.getElementById("manualCode").value.trim(),
        };

        try {
            const result = await apiFetch("/api/admin/users", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            manualStudentMessage.textContent = result.message;
            manualStudentMessage.style.color = "#16a34a";
            manualStudentForm.reset();
            await loadPendingUsers();
            await loadAttendance();
        } catch (error) {
            manualStudentMessage.textContent = error.message;
            manualStudentMessage.style.color = "#dc2626";
        }
    });
}

if (exportButton) {
    exportButton.addEventListener("click", async () => {
        try {
            const selectedDate = dateFilter && dateFilter.value ? dateFilter.value : "";
            const url = selectedDate
                ? `/api/attendance/export?date=${encodeURIComponent(selectedDate)}`
                : "/api/attendance/export";

            const response = await fetch(url);
            const blob = await response.blob();
            const urlObject = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = urlObject;
            link.download = selectedDate ? `attendance-${selectedDate}.csv` : "attendance.csv";
            link.click();
            URL.revokeObjectURL(urlObject);
        } catch (error) {
            alert("Unable to export the CSV file.");
        }
    });
}

loadPendingUsers();
loadAttendance();
