const wishlistItemsContainer = document.getElementById("wishlistItems");
const wishlistMessage = document.getElementById("message");

function showMessage(message) {
    wishlistMessage.textContent = message;
}

async function loadWishlist() {
    try {
        const response = await fetch("/api/wishlist", { credentials: "include" });
        const data = await response.json();

        if (!response.ok) {
            showMessage(data.message || "Could not load your wishlist.");
            return;
        }

        wishlistItemsContainer.innerHTML = "";

        if (data.length === 0) {
            wishlistItemsContainer.textContent = "Your wishlist is empty.";
            return;
        }

        for (const item of data) {
            const card = document.createElement("article");
            card.className = "product-card";

            const title = document.createElement("h2");
            title.textContent = item.name;

            const details = document.createElement("p");
            details.textContent = `Shop: ${item.shop_name} | Price: ${item.unit_price} | Stock: ${item.in_stock}`;

            const removeButton = document.createElement("button");
            removeButton.textContent = "Remove";
            removeButton.addEventListener("click", () => removeItem(item.prod_id));

            card.append(title, details, removeButton);
            wishlistItemsContainer.appendChild(card);
        }
    } catch (error) {
        showMessage("Could not connect to the server.");
    }
}

async function removeItem(productId) {
    const response = await fetch(`/api/wishlist/${productId}`, {
        method: "DELETE",
        credentials: "include"
    });

    if (!response.ok) {
        const data = await response.json();
        showMessage(data.message || "Could not remove the item.");
        return;
    }

    showMessage("Item removed.");
    loadWishlist();
}

loadWishlist();
