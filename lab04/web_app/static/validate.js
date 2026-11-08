/*
 * Клієнтська валідація форм (рівень 3).
 * Форми з атрибутом data-validate перевіряються перед відправкою:
 * стандартні атрибути HTML5 (required, min, max, minlength) + власні правила data-rule.
 * Серверна валідація (validators.py) виконується незалежно від цієї перевірки.
 */
(function () {
    'use strict';

    const RULES = {
        phone: [/^\+380\d{9}$/, 'Телефон у форматі +380XXXXXXXXX'],
        email: [/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/, 'Некоректний email'],
        vin: [/^[A-HJ-NPR-Z0-9]{17}$/, 'VIN: 17 символів, латиниця без I, O, Q та цифри'],
        container: [/^[A-Z]{4}\d{7}$/, 'Контейнер: 4 латинські літери і 7 цифр'],
        username: [/^[A-Za-z0-9_]{3,30}$/, 'Логін: 3-30 латинських літер, цифр або _'],
        password: [/^(?=.*\d)(?=.*[A-Za-zА-Яа-яІіЇїЄєҐґ]).{8,}$/, 'Пароль: щонайменше 8 символів, літери та цифри'],
        money: [/^\d+([.,]\d{1,2})?$/, 'Сума: додатне число, до 2 знаків після коми'],
    };

    function errorBox(input) {
        const group = input.closest('.form-group');
        if (group) return group.querySelector('.field-error');
        const form = input.closest('form');
        return form ? form.querySelector('.field-error') : null;
    }

    function setError(input, message) {
        input.classList.toggle('invalid', !!message);
        input.setCustomValidity(message || '');
        const box = errorBox(input);
        if (box && (message || box.dataset.owner === input.name)) {
            box.textContent = message || '';
            box.dataset.owner = message ? input.name : '';
        }
    }

    function check(input) {
        const value = input.value.trim();
        const label = (input.closest('.form-group')?.querySelector('label')?.textContent || input.placeholder || input.name)
            .replace('*', '').trim();

        if (input.type === 'checkbox' || input.type === 'hidden') return '';
        if (input.required && !value) return `Поле «${label}» обов'язкове`;
        if (!value) return '';
        if (input.minLength > 0 && value.length < input.minLength) return `«${label}»: не менше ${input.minLength} символів`;
        if (input.type === 'number') {
            const num = Number(value.replace(',', '.'));
            if (Number.isNaN(num)) return `«${label}»: потрібне число`;
            if (input.min !== '' && num < Number(input.min)) return `«${label}»: не менше ${input.min}`;
            if (input.max !== '' && num > Number(input.max)) return `«${label}»: не більше ${input.max}`;
        }
        const rule = input.dataset.rule;
        if (!rule) return '';
        if (RULES[rule] && !RULES[rule][0].test(value)) return RULES[rule][1];
        if (rule === 'not-future' && value > new Date().toISOString().slice(0, 10)) return `«${label}»: дата не може бути в майбутньому`;
        if (rule.startsWith('same:')) {
            const other = input.form.elements[rule.slice(5)];
            if (other && other.value !== input.value) return 'Паролі не збігаються';
        }
        if (rule === 'date-range-end') {
            const start = input.form.querySelector('[data-rule="date-range-start"]');
            if (start && start.value && value <= start.value && input.name === 'arrival_date') return 'Дата прибуття має бути пізнішою за відправлення';
            if (start && start.value && value < start.value) return 'Кінець періоду раніший за початок';
            if (start && !start.value && input.name === 'arrival_date') return 'Спочатку вкажіть дату відправлення';
        }
        return '';
    }

    function validateForm(form) {
        let firstInvalid = null;
        form.querySelectorAll('input, select, textarea').forEach((input) => {
            if (input.disabled || input.closest('[hidden]')) return;
            const message = check(input);
            setError(input, message);
            if (message && !firstInvalid) firstInvalid = input;
        });
        if (firstInvalid) firstInvalid.focus();
        return !firstInvalid;
    }

    document.querySelectorAll('form[data-validate]').forEach((form) => {
        form.addEventListener('submit', (event) => {
            if (!validateForm(form)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);
        form.querySelectorAll('input, select').forEach((input) => {
            input.addEventListener('blur', () => setError(input, check(input)));
            input.addEventListener('input', () => {
                if (input.classList.contains('upper')) {
                    const pos = input.selectionStart;
                    input.value = input.value.toUpperCase();
                    if (input.type === 'text' || !input.type) input.setSelectionRange(pos, pos);
                }
                if (input.classList.contains('invalid')) setError(input, check(input));
            });
        });
    });

    // Поля двигуна / батареї залежно від типу пального
    document.querySelectorAll('select[name="fuel_type"]').forEach((select) => {
        const form = select.form;
        const update = () => {
            const electric = select.value === 'electric';
            form.querySelectorAll('[data-fuel]').forEach((input) => {
                const isBattery = input.dataset.fuel === 'battery';
                const active = select.value && (electric === isBattery);
                input.disabled = !active;
                input.required = !!active;
                if (!active) { input.value = ''; setError(input, ''); }
            });
        };
        select.addEventListener('change', update);
        update();
    });
})();
