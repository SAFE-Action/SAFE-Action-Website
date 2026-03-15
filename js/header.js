// Slim header on scroll
(function() {
    var header = document.querySelector('.site-header');
    if (!header) return;
    var scrolled = false;
    window.addEventListener('scroll', function() {
        var shouldScroll = window.scrollY > 40;
        if (shouldScroll !== scrolled) {
            scrolled = shouldScroll;
            if (scrolled) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        }
    });
})();
