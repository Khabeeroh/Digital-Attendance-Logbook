const tableBody = document.getElementById("attendanceTableBody");
const emptyState = document.getElementById("emptyState");
const dateFilter = document.getElementById("dateFilter");
const recordCount = document.getElementById("recordCount");
const pendingUsersList = document.getElementById("pendingUsersList");
const activeStudentsList = document.getElementById("activeStudentsList");
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
        pendingUsersList.innerHTML =
            '<p class="empty-state visible">No pending registrations.</p>';
        return;
    }

    users.forEach((user) => {
        const card = document.createElement("div");
        card.className = "pending-user-card";

        const info = document.createElement("div");

        const name = document.createElement("strong");
        name.textContent = user.fullName;

        const email = document.createElement("small");
        email.textContent = user.email;

        info.append(name, email);

        // Approve button
        const approveButton = document.createElement("button");
        approveButton.type = "button";
        approveButton.className = "approve-user-button";
        approveButton.textContent = "Approve";

        approveButton.addEventListener("click", async () => {
            const confirmed = confirm(
                `Are you sure you want to approve ${user.fullName}?\n\n` +
                `An approval email containing their access code will be sent.`
            );

            if (!confirmed) return;

            approveButton.disabled = true;
            rejectButton.disabled = true;
            approveButton.textContent = "Approving...";

            try {
                const result = await apiFetch(
                    `/api/admin/users/${user.id}/approve`,
                    {
                        method: "POST",
                    }
                );

                alert(result.message);

                await loadPendingUsers();
                await loadActiveStudents();
                await loadAttendance();

            } catch (error) {
                alert(error.message);

                approveButton.disabled = false;
                rejectButton.disabled = false;
                approveButton.textContent = "Approve";
            }
        });

        // Reject button
        const rejectButton = document.createElement("button");
        rejectButton.type = "button";
        rejectButton.className = "reject-user-button";
        rejectButton.textContent = "Reject";

        rejectButton.addEventListener("click", async () => {
            const confirmed = confirm(
                `Are you sure you want to reject ${user.fullName}?\n\n` +
                `No approval email will be sent.`
            );

            if (!confirmed) return;

            approveButton.disabled = true;
            rejectButton.disabled = true;
            rejectButton.textContent = "Rejecting...";

            try {
                const result = await apiFetch(
                    `/api/admin/users/${user.id}/reject`,
                    {
                        method: "POST",
                    }
                );

                alert(result.message);

                await loadPendingUsers();

            } catch (error) {
                alert(error.message);

                approveButton.disabled = false;
                rejectButton.disabled = false;
                rejectButton.textContent = "Reject";
            }
        });

        const buttons = document.createElement("div");
        buttons.className = "pending-user-actions";

        buttons.append(approveButton, rejectButton);

        card.append(info, buttons);

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
        await loadActiveStudents();
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
            await loadActiveStudents();
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
function renderActiveStudents(users) {
    if (!activeStudentsList) return;

    activeStudentsList.innerHTML = "";

    if (!users.length) {
        activeStudentsList.innerHTML =
            '<p class="empty-state visible">No active students.</p>';
        return;
    }

    users.forEach((user) => {
        const card = document.createElement("div");
        card.className = "active-student-card";

        const info = document.createElement("div");

        const name = document.createElement("strong");
        name.textContent = user.fullName;

        const email = document.createElement("small");
        email.textContent = user.email;

        info.append(name, email);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "remove-student-button";
        removeButton.textContent = "Remove";

        removeButton.addEventListener("click", async () => {
            const confirmed = confirm(
                `Are you sure you want to remove ${user.fullName}?\n\n` +
                `Their attendance records will NOT be deleted. ` +
                `They will only be removed from the active student list.`
            );

            if (!confirmed) return;

            removeButton.disabled = true;
            removeButton.textContent = "Removing...";

            try {
                const result = await apiFetch(
                    `/api/admin/users/${user.id}/remove`,
                    {
                        method: "POST",
                    }
                );

                alert(result.message);

                await loadActiveStudents();
                await loadAttendance();
            } catch (error) {
                alert(error.message);

                removeButton.disabled = false;
                removeButton.textContent = "Remove";
            }
        });

        card.append(info, removeButton);
        activeStudentsList.appendChild(card);
    });
}

async function loadActiveStudents() {
    if (!activeStudentsList) return;

    try {
        const users = await apiFetch("/api/admin/users/active");
        renderActiveStudents(users);
    } catch (error) {
        activeStudentsList.innerHTML =
            `<p class="empty-state visible">${error.message}</p>`;
    }
}

loadPendingUsers();
loadActiveStudents();
loadAttendance();
