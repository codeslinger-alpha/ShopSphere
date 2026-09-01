const productsContainer =
    document.getElementById("products");


async function loadProducts() {

    try {

        const response =
            await fetch("/api/products");


        const products =
            await response.json();


        productsContainer.innerHTML = "";


        if (products.length === 0) {

            productsContainer.textContent =
                "No products available.";

            return;
        }


        for (const product of products) {

            const card =
                document.createElement("div");

            card.className = "product-card";


            card.innerHTML = `
                <h2>${product.name}</h2>

                <p>
                    Manufacturer:
                    ${product.manufacturer}
                </p>

                <p>
                    Shop:
                    ${product.shop_name}
                </p>

                <p>
                    Price:
                    ${product.unit_price}
                </p>

                <p>
                    Stock:
                    ${product.in_stock}
                </p>

                <p>
                    ${product.description || ""}
                </p>

                <button
                    onclick="addToCart(${product.prod_id})">
                    Add to cart
                </button>

                <button
                    onclick="addToWishlist(${product.prod_id})">
                    Wishlist
                </button>
            `;


            productsContainer.appendChild(card);
        }


    } catch (error) {

        console.error(error);

        productsContainer.textContent =
            "Could not load products.";
    }
}


// --------------------------------------------------
// Add to cart
// --------------------------------------------------

async function addToCart(productId) {

    // Temporary because authentication doesn't exist yet.

    const userId =
        prompt("Enter your user ID");


    if (!userId) {
        return;
    }


    try {

        const response =
            await fetch("/api/cart", {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    user_id: Number(userId),
                    prod_id: productId,
                    quantity: 1
                })
            });


        const data =
            await response.json();


        if (data.success) {

            alert("Added to cart.");

        } else {

            alert(data.message);
        }


    } catch (error) {

        console.error(error);

        alert("Could not connect to server.");
    }
}


// --------------------------------------------------
// Wishlist
// --------------------------------------------------

async function addToWishlist(productId) {

    const userId =
        prompt("Enter your user ID");


    if (!userId) {
        return;
    }


    try {

        const response =
            await fetch("/api/wishlist", {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    user_id: Number(userId),
                    prod_id: productId
                })
            });


        const data =
            await response.json();


        if (data.success) {

            alert("Added to wishlist.");

        } else {

            alert(data.message);
        }


    } catch (error) {

        console.error(error);

        alert("Could not connect to server.");
    }
}


loadProducts();