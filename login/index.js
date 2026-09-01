function getToday() {
  return new Date().toISOString().split("T")[0];
}

function getCurrentTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

const signInForm = document.getElementById("signInForm");
if (signInForm) {
  signInForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const fullName = document.getElementById("name").value.trim();
    const code = document.getElementById("password").value.trim();
    const errorMessage = document.getElementById("errorMessage");

    if (!fullName) {
      errorMessage.textContent = "Please enter your name.";
      return;
    }

    if (!code) {
      errorMessage.textContent = "Please enter your access code.";
      return;
    }

    try {
      errorMessage.textContent = "Signing you in...";
      const result = await postJson("/api/attendance/signin", { fullName, code });
      localStorage.setItem("currentUser", JSON.stringify({
        fullName: result.user.fullName,
        email: result.user.email,
        signInTime: getCurrentTime(),
        date: getToday(),
      }));
      window.location.href = "../Alert.html";
    } catch (error) {
      errorMessage.textContent = error.message;
    }
  });
}

const userNameElement = document.getElementById("userName");
if (userNameElement) {
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");

  if (!currentUser) {
    window.location.href = "login/login.html";
  } else {
    document.getElementById("userName").textContent = currentUser.fullName;
    document.getElementById("signInTime").textContent = currentUser.signInTime || "--";
    document.getElementById("attendanceDate").textContent = currentUser.date || getToday();
  }
}

const signOutForm = document.getElementById("signOutForm");
if (signOutForm) {
  signOutForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const fullName = document.getElementById("signOutName").value.trim();
    const code = document.getElementById("signOutCode").value.trim();
    const message = document.getElementById("signOutMessage");

    if (!fullName) {
      message.textContent = "Please enter your full name.";
      message.style.color = "#dc2626";
      return;
    }

    if (!code) {
      message.textContent = "Please enter your access code.";
      message.style.color = "#dc2626";
      return;
    }

    try {
      const result = await postJson("/api/attendance/signout", { fullName, code });
      const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
      if (currentUser && currentUser.fullName === fullName) {
        localStorage.removeItem("currentUser");
      }
      message.textContent = result.message;
      message.style.color = "#16a34a";
      setTimeout(() => {
        window.location.href = "login.html";
      }, 600);
    } catch (error) {
      message.textContent = error.message;
      message.style.color = "#dc2626";
    }
  });
}

function signOutCurrentUser(event) {
  if (event) {
    event.preventDefault();
  }

  localStorage.removeItem("currentUser");
  window.location.href = "login/login.html";
}
