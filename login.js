const form = document.querySelector("#loginForm");
const button = document.querySelector("#loginButton");
const message = document.querySelector("#formMessage");
const username = document.querySelector("#username");
const password = document.querySelector("#password");

username.value = "yuanfang";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  button.disabled = true;
  button.textContent = "登录中";

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error && payload.error.message ? payload.error.message : "登录失败");
    }

    window.location.href = "/admin";
  } catch (error) {
    message.textContent = error.message || "登录失败";
  } finally {
    button.disabled = false;
    button.textContent = "进入后台";
  }
});
