const form = document.getElementById("loginForm");
const message = document.getElementById("message");

form.addEventListener("submit", async (event) => {

    event.preventDefault();

    const email =
        document.getElementById("email").value;

    const password =
        document.getElementById("password").value;

    const role =
        document.getElementById("userType").value;


    try {

        const response = await fetch("/api/login", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                email,
                password,
                role
            })

        });


        const data = await response.json();


        if (response.ok) {

            message.textContent =
                `Welcome, ${data.user.name}!`;

            const dashboards = {
                customer: "customer.html",
                vendor: "vendor.html",
                delivery: "delivery.html",
                admin: "admin.html"
            };

            window.setTimeout(() => {
                window.location.href = dashboards[data.user.role];
            }, 500);

        } else {

            message.textContent =
                data.message || "Could not log in.";
        }

    } catch (error) {

        console.error(error);

        message.textContent =
            "Could not connect to server.";
    }
});
