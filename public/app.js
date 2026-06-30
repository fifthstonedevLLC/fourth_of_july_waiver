'use strict';

(function () {
  const MAX_MINORS = 8;

  const form = document.getElementById('waiver-form');
  const minorsList = document.getElementById('minors-list');
  const addMinorBtn = document.getElementById('add-minor');
  const wantsEmail = document.getElementById('wantsEmail');
  const emailRow = document.getElementById('email-row');
  const emailInput = document.getElementById('email');
  const errorBox = document.getElementById('error');
  const submitBtn = document.getElementById('submit-btn');
  const canvas = document.getElementById('signature-pad');
  const clearBtn = document.getElementById('clear-sig');

  // ---- Today's date ----
  document.getElementById('today').textContent = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // ---- Signature pad (with HiDPI handling) ----
  const signaturePad = new SignaturePad(canvas, {
    backgroundColor: 'rgba(255,255,255,0)',
    penColor: '#0a1a3a',
  });

  function resizeCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const data = signaturePad.toData();
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    signaturePad.clear();
    if (data && data.length) signaturePad.fromData(data);
  }
  window.addEventListener('resize', resizeCanvas);
  // Defer until layout is settled.
  window.requestAnimationFrame(resizeCanvas);

  clearBtn.addEventListener('click', function () {
    signaturePad.clear();
  });

  // ---- Minor rows ----
  function addMinorRow(value) {
    const rows = minorsList.querySelectorAll('.minor-row');
    if (rows.length >= MAX_MINORS) return;

    const row = document.createElement('div');
    row.className = 'minor-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Child #${rows.length + 1} — First & Last name`;
    input.autocomplete = 'off';
    if (value) input.value = value;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-minor';
    remove.setAttribute('aria-label', 'Remove this child');
    remove.textContent = '×';
    remove.addEventListener('click', function () {
      row.remove();
      refreshPlaceholders();
      updateAddButton();
    });

    row.appendChild(input);
    row.appendChild(remove);
    minorsList.appendChild(row);
    updateAddButton();
  }

  function refreshPlaceholders() {
    minorsList.querySelectorAll('.minor-row input').forEach(function (input, i) {
      input.placeholder = `Child #${i + 1} — First & Last name`;
    });
  }

  function updateAddButton() {
    const count = minorsList.querySelectorAll('.minor-row').length;
    addMinorBtn.disabled = count >= MAX_MINORS;
    addMinorBtn.textContent = count >= MAX_MINORS
      ? 'Maximum of 8 children reached'
      : '+ Add another child';
  }

  addMinorBtn.addEventListener('click', function () {
    addMinorRow('');
  });

  // Start with one empty row.
  addMinorRow('');

  // ---- Email toggle ----
  wantsEmail.addEventListener('change', function () {
    emailRow.classList.toggle('hidden', !wantsEmail.checked);
    if (!wantsEmail.checked) emailInput.value = '';
  });

  // ---- Helpers ----
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }

  function collectMinors() {
    return Array.from(minorsList.querySelectorAll('.minor-row input'))
      .map((input) => input.value.trim())
      .filter(Boolean);
  }

  // Escape user-supplied text before putting it in innerHTML.
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Submit ----
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    const adultName = document.getElementById('adultName').value.trim();
    if (!adultName) {
      showError('Please enter the Parent/Guardian name.');
      return;
    }
    if (signaturePad.isEmpty()) {
      showError('Please sign in the signature box before submitting.');
      return;
    }
    if (wantsEmail.checked) {
      const email = emailInput.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('Please enter a valid email address, or uncheck the email option.');
        return;
      }
    }

    const payload = {
      adultName,
      minors: collectMinors(),
      wantsEmail: wantsEmail.checked,
      email: wantsEmail.checked ? emailInput.value.trim() : '',
      signature: signaturePad.toDataURL('image/png'),
    };

    await submitWaiver(payload);
  });

  async function submitWaiver(payload) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing…';

    try {
      const res = await fetch('/api/waiver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data = {};
      try {
        data = await res.json();
      } catch (_) { /* response wasn't JSON */ }

      // A waiver for this adult is already on file for today.
      if (res.status === 409 && data && data.duplicate) {
        showDuplicatePrompt(data, payload);
        return;
      }

      if (!res.ok) {
        showError((data && data.error) || 'Something went wrong. Please try again.');
        return;
      }

      showSuccess(data);
    } catch (err) {
      showError('Could not reach the server. Please check your connection and try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign Waiver';
    }
  }

  function showDuplicatePrompt(data, payload) {
    clearError();

    const existing = document.getElementById('dup-prompt');
    if (existing) existing.remove();

    const onFile = (data.existing && data.existing.minors) || [];
    const newChildren = data.newChildren || [];
    const name = (data.existing && data.existing.adultName) || payload.adultName;
    const listed = onFile.length
      ? ', listing ' + esc(onFile.join(', '))
      : '';

    const box = document.createElement('div');
    box.id = 'dup-prompt';
    box.className = 'duplicate-prompt';

    if (newChildren.length === 0) {
      // Same adult, same children — a true duplicate. Nothing to add.
      box.innerHTML =
        '<h3>You\'re already on file ✔</h3>' +
        '<p>A waiver is already on file for <strong>' + esc(name) + '</strong> today' +
        listed + '. There\'s nothing new to add — you\'re all set.</p>';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn-secondary';
      ok.textContent = 'OK';
      ok.addEventListener('click', function () { box.remove(); });
      box.appendChild(ok);
    } else {
      // Same adult, but new children — offer to add them to the existing waiver.
      box.innerHTML =
        '<h3>A waiver is already on file</h3>' +
        '<p><strong>' + esc(name) + '</strong> already signed today' + listed + '.</p>' +
        '<p>Add <strong>' + esc(newChildren.join(', ')) +
        '</strong> to that existing waiver?</p>';
      const actions = document.createElement('div');
      actions.className = 'dup-actions';

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn-primary';
      add.textContent = 'Add to my waiver';
      add.addEventListener('click', function () {
        box.remove();
        submitWaiver(Object.assign({}, payload, { addToExisting: true }));
      });

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn-secondary';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', function () { box.remove(); });

      actions.appendChild(add);
      actions.appendChild(cancel);
      box.appendChild(actions);
    }

    form.appendChild(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showSuccess(data) {
    let copyLine;
    if (data && data.emailed) {
      copyLine = 'A copy has been emailed to you for your records.';
    } else if (data && data.emailRequested && data.emailError) {
      copyLine =
        'Your waiver is on file, but we couldn\'t send the email copy right now. ' +
        'Please let a volunteer know if you need a copy.';
    } else {
      copyLine = 'Your signed waiver is now on file with the event organizers.';
    }

    let heading = 'Thank you — your waiver is signed!';
    let intro = '';
    if (data && data.merged) {
      heading = 'Updated — your waiver is on file!';
      const added = (data.addedChildren && data.addedChildren.length)
        ? data.addedChildren.join(', ')
        : '';
      if (added) {
        intro = '<p>We added <strong>' + esc(added) +
          '</strong> to the waiver already on file for you.</p>';
      }
    }

    form.innerHTML =
      '<div style="text-align:center;padding:24px">' +
      '<div style="font-size:48px">✅</div>' +
      '<h2 style="color:#0a3161;margin:8px 0">' + heading + '</h2>' +
      intro +
      '<p>' + copyLine + '</p>' +
      '<p style="color:#5a5a5a">You can close this page.</p>' +
      '</div>';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
})();
