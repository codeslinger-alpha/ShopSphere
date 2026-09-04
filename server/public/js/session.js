async function enforcePageRole(requiredRole) {
    try {
        const response = await fetch("/api/auth/me", { credentials: "include" });

        if (!response.ok) {
            window.location.replace("login.html");
            return;
        }

        const { user } = await response.json();

        if (user.role !== requiredRole) {
            window.location.replace("login.html");
        }
    } catch (error) {
        window.location.replace("login.html");
    }
}

async function logout() {
    try {
        await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "include"
        });
    } finally {
        window.location.replace("login.html");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const signOutButton = document.getElementById("signOut");

    if (signOutButton) {
        signOutButton.addEventListener("click", (event) => {
            event.preventDefault();
            logout();
        });
    }
});
