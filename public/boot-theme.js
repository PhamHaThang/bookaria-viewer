try {
    const preference = localStorage.getItem('bookaria.theme');
    document.documentElement.classList.toggle(
        'dark',
        preference === 'dark' ||
            (preference !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches),
    );
} catch {
    document.documentElement.classList.toggle(
        'dark',
        matchMedia('(prefers-color-scheme: dark)').matches,
    );
}
