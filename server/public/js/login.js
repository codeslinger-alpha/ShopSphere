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


        if (data.success) {

            message.textContent =
                `Welcome, ${data.user.name}!`;

            console.log(data.user);

        } else {

            message.textContent =
                data.message;
        }

    } catch (error) {

        console.error(error);

        message.textContent =
            "Could not connect to server.";
    }
});