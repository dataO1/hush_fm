/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./index.html"],
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      "business", // Dark theme (current)
      "corporate", // Light theme alternative
      "dark", // Standard dark theme
      "light" // Standard light theme
    ],
    logs: false,
    darkTheme: "business", // Use business as default dark theme
    base: true, // Apply background color and foreground color for root element
    styled: true, // Include daisyUI colors and design decisions for all components
    utils: true, // Adds responsive and modifier utility classes
  }
}