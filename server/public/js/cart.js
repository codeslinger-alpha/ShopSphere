const cartItemsContainer = document.getElementById("cartItems");
const cartMessage = document.getElementById("message");

function showMessage(message) {
    cartMessage.textContent = message;
}

async function loadCart() {
    try {
        const response = await fetch("/api/cart", { credentials: "include" });
        const data = await response.json();

        if (!response.ok) {
            showMessage(data.message || "Could not load your cart.");
            return;
        }

        cartItemsContainer.innerHTML = "";

        if (data.length === 0) {
            cartItemsContainer.textContent = "Your cart is empty.";
            return;
        }

        for (const item of data) {
            const card = document.createElement("article");
            card.className = "product-card";

            const title = document.createElement("h2");
            title.textContent = item.name;

            const details = document.createElement("p");
            details.textContent = `Price: ${item.unit_price} | Subtotal: ${item.subtotal}`;

            const quantityInput = document.createElement("input");
            quantityInput.type = "number";
            quantityInput.min = "1";
            quantityInput.value = item.quantity;
            quantityInput.setAttribute("aria-label", `Quantity for ${item.name}`);

            const updateButton = document.createElement("button");
            updateButton.textContent = "Update quantity";
            updateButton.addEventListener("click", () => updateQuantity(item.prod_id, quantityInput.value));

            const removeButton = document.createElement("button");
            removeButton.textContent = "Remove";
            removeButton.addEventListener("click", () => removeItem(item.prod_id));

            card.append(title, details, quantityInput, updateButton, removeButton);
            cartItemsContainer.appendChild(card);
        }
    } catch (error) {
        showMessage("Could not connect to the server.");
    }
}

async function updateQuantity(productId, quantity) {
    const response = await fetch(`/api/cart/${productId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: Number(quantity) })
    });
    const data = await response.json();

    if (!response.ok) {
        showMessage(data.message || "Could not update the cart.");
        return;
    }

    showMessage(data.message);
    loadCart();
}

async function removeItem(productId) {
    const response = await fetch(`/api/cart/${productId}`, {
        method: "DELETE",
        credentials: "include"
    });

    if (!response.ok) {
        const data = await response.json();
        showMessage(data.message || "Could not remove the item.");
        return;
    }

    showMessage("Item removed.");
    loadCart();
}

loadCart();
