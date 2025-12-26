/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        gruvbox: {
          // Background variants
          'bg-hard': '#1d2021',
          'bg-medium': '#282828', 
          'bg-soft': '#32302f',
          'bg-1': '#3c3836',
          'bg-2': '#504945',
          'bg-3': '#665c54',
          'bg-4': '#7c6f64',
          
          // Foreground
          'fg': '#ebdbb2',
          'fg-1': '#fbf1c7',
          'fg-2': '#d5c4a1',
          'fg-3': '#bdae93',
          'fg-4': '#a89984',
          
          // Colors (muted versions)
          'red': '#cc241d',
          'green': '#98971a',
          'yellow': '#d79921',
          'blue': '#458588',
          'purple': '#b16286',
          'aqua': '#689d6a',
          'orange': '#d65d0e',
          
          // Colors (bright versions)
          'red-bright': '#fb4934',
          'green-bright': '#b8bb26',
          'yellow-bright': '#fabd2f',
          'blue-bright': '#83a598',
          'purple-bright': '#d3869b',
          'aqua-bright': '#8ec07c',
          'orange-bright': '#fe8019',
        }
      },
      backgroundImage: {
        'hush-main': 'linear-gradient(135deg, #1d2021 0%, #282828 50%, #32302f 100%)',
        // 'hush-brand': 'linear-gradient(to right, #fe8019, #fabd2f)',
        // 'hush-brand-hover': 'linear-gradient(to right, #d65d0e, #d79921)',
      },
      animation: {
        'music-pulse': 'music-pulse 1.2s ease-in-out infinite',
      },
      keyframes: {
        'music-pulse': {
          '0%, 20%': { opacity: '1', transform: 'scale(1)' },
          '10%': { opacity: '0.8', transform: 'scale(1.02)' },
          '40%, 100%': { opacity: '1', transform: 'scale(1)' },
        }
      }
    }
  },
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