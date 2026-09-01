const registryNameInput = document.getElementById("name") || document.getElementById("signOutName");
const registrySignInForm = document.getElementById("signInForm") || document.getElementById("signOutForm");
const registryErrorMessage = document.getElementById("errorMessage") || document.getElementById("signOutMessage");

let allUsers = [];

async function loadApprovedUsers() {
  if (!registryNameInput) {
    return;
  }

  try {
    const response = await fetch("/api/users?approved=true");
    allUsers = await response.json();

    // Create custom dropdown container
    createCustomDropdown();
  } catch (error) {
    if (registryErrorMessage) {
      registryErrorMessage.textContent = "Student registry could not be loaded.";
    }
  }
}

function createCustomDropdown() {
  const oldDropdown = document.getElementById("customDropdownContainer");
  if (oldDropdown) {
    oldDropdown.remove();
  }

  const inputGroup = registryNameInput.parentElement.parentElement;
  let dropdownIcon = inputGroup.querySelector(".dropdown-icon");
  if (!dropdownIcon) {
    dropdownIcon = document.createElement("i");
    dropdownIcon.className = "fa-solid fa-chevron-down dropdown-icon";
    inputGroup.appendChild(dropdownIcon);
  }

  const dropdownContainer = document.createElement("div");
  dropdownContainer.id = "customDropdownContainer";
  dropdownContainer.className = "custom-dropdown";

  const dropdownList = document.createElement("ul");
  dropdownList.className = "custom-dropdown-list";

  function renderDropdownItems(searchText = "") {
    dropdownList.innerHTML = "";

    const normalizedSearch = searchText.trim().toLowerCase();
    const filteredUsers = normalizedSearch
      ? allUsers.filter((user) => {
          const fullName = (user.fullName || "").toLowerCase();
          return fullName.includes(normalizedSearch);
        })
      : allUsers;

    if (!filteredUsers.length) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "custom-dropdown-item no-results";
      emptyItem.textContent = "No matching names found";
      emptyItem.style.cursor = "default";
      emptyItem.style.opacity = "0.7";
      dropdownList.appendChild(emptyItem);
      return;
    }

    filteredUsers.forEach((user) => {
      const option = document.createElement("li");
      option.textContent = user.fullName;
      option.className = "custom-dropdown-item";
      option.addEventListener("click", () => {
        registryNameInput.value = user.fullName;
        dropdownContainer.style.display = "none";
        dropdownIcon.classList.remove("rotate-up");
      });
      dropdownList.appendChild(option);
    });
  }

  dropdownContainer.appendChild(dropdownList);
  inputGroup.insertBefore(dropdownContainer, registryNameInput.parentElement.nextSibling);

  const setDropdown = (show) => {
    dropdownContainer.style.display = show ? "block" : "none";
    dropdownIcon.classList.toggle("rotate-up", show);
  };

  registryNameInput.addEventListener("click", (event) => {
    event.stopPropagation();
    setDropdown(true);
    renderDropdownItems(registryNameInput.value);
  });

  registryNameInput.addEventListener("focus", () => {
    setDropdown(true);
    renderDropdownItems(registryNameInput.value);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".custom-dropdown") && !event.target.closest(".input-group")) {
      setDropdown(false);
    }
  });

  registryNameInput.addEventListener("input", (event) => {
    const searchText = event.target.value;
    setDropdown(true);
    renderDropdownItems(searchText);
  });

  renderDropdownItems();
  setDropdown(false);
}

if (registryNameInput) {
  loadApprovedUsers();
}

if (registrySignInForm && registryNameInput && registryErrorMessage) {
  registrySignInForm.addEventListener("submit", (event) => {
    const selectedName = registryNameInput.value.trim();
    if (!selectedName) {
      event.preventDefault();
      event.stopImmediatePropagation();
      registryErrorMessage.textContent = "Please select a registered student name.";
      registryErrorMessage.style.color = "#dc2626";
    }
  }, true);
}
