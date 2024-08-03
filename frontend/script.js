document.getElementById("login-btn").addEventListener("click", () => {
  window.location.href = "http://localhost:3000/auth/google";
});

window.onload = () => {
  fetch("http://localhost:3000/api/user")
    .then((response) => response.json())
    .then((user) => {
      if (user.email) {
        document.getElementById("user-info").classList.remove("hidden");
        document.getElementById("email").textContent = `Email: ${user.email}`;
      }
    })
    .catch((error) => {
      console.error("Error fetching user data:", error);
    });
};
