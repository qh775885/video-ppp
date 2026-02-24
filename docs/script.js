// script.js
document.addEventListener('DOMContentLoaded', () => {
    // 3D Tilt Effect on the hero image
    const glass = document.querySelector('.hero-image-glass');
    const heroWrapper = document.querySelector('.hero-image-wrapper');

    heroWrapper.addEventListener('mousemove', (e) => {
        const rect = heroWrapper.getBoundingClientRect();
        const x = e.clientX - rect.left; // x position within the element
        const y = e.clientY - rect.top;  // y position within the element

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const deltaX = (x - centerX) / centerX;
        const deltaY = (y - centerY) / centerY;

        // Max rotation angle in degrees
        const maxAngle = 10;
        
        glass.style.transform = `rotateX(${-deltaY * maxAngle}deg) rotateY(${deltaX * maxAngle}deg) scale(1.02)`;
        glass.style.transition = 'none'; // remove transition for smooth tracking
    });

    heroWrapper.addEventListener('mouseleave', () => {
        glass.style.transform = `rotateX(5deg) scale(0.95)`;
        glass.style.transition = 'transform 0.5s ease, box-shadow 0.5s ease';
    });

    // Smooth reveal animation for feature cards on scroll
    const cards = document.querySelectorAll('.feature-card');
    
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = `all 0.6s ease ${index * 0.1}s`;
        observer.observe(card);
    });
});
