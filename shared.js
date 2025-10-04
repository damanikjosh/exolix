// Shared utilities for ExoLiX

// Navigation template
const navTemplate = `
<nav class="border-b border-gray-800 backdrop-blur-sm bg-gray-900/80 relative z-50">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="flex justify-between h-16">
      <div class="flex items-center">
        <a href="landing.html" class="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">ExoLiX</a>
      </div>
      <div class="flex items-center space-x-6">
        <a href="multiTableExplorer.html" class="nav-link text-gray-300 hover:text-blue-400 transition" data-page="explorer">Data Explorer</a>
        <a href="featureMapping.html" class="nav-link text-gray-300 hover:text-blue-400 transition" data-page="mapping">Feature Mapping</a>
        <a href="training.html" class="nav-link text-gray-300 hover:text-blue-400 transition" data-page="training">Train Model</a>
      </div>
    </div>
  </div>
</nav>
`;

// Load navigation component and set active page
export function loadNavigation(activePage) {
  const navContainer = document.getElementById('nav-container');
  
  if (!navContainer) {
    console.error('Nav container not found!');
    return;
  }
  
  // Insert navigation template
  navContainer.innerHTML = navTemplate;
  
  // Set active page
  if (activePage) {
    const activeLink = document.querySelector(`.nav-link[data-page="${activePage}"]`);
    if (activeLink) {
      activeLink.classList.remove('text-gray-300', 'hover:text-blue-400');
      activeLink.classList.add('text-blue-400', 'font-semibold');
    }
  }
}
