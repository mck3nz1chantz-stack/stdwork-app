// ============================================================
//  StdWork v2.8 - Core Logic (external file)
//  Loaded by StdWork_*.html
//  Split keeps context manageable when editing specific features.
// ============================================================

// ==================== 1. GLOBAL STATE ====================
        let currentUser = null;
        let areas = ["ASM02", "ASM05", "ASM07", "ASM11", "ASM55"];
        let studies = [];
        let deletedStudies = [];           // Soft-deleted studies with audit metadata
        let laps = [];                     // Current study elements
        let cycleTimes = [];               // Current study full cycles
        let startTime = 0;
        let elapsedTime = 0;
        let isRunning = false;
        let timerInterval = null;
        let workflowMode = 'elements';     // 'elements' | 'cycles'
        let cycleElementLapIndex = 0;      // Next element index for Element Lap in cycles mode
        let cycleElementLapAnchor = 0;     // Main-timer ms at last Element Lap (split timing)
        let pendingDeleteStudyId = null;
        let captureStudyId = null;         // loaded study id for in-place edits
        let workInstructions = [];         // { id, html, imageBase64? }
        let periodicWorkItems = [];        // { id, name, itemType, observations[], intervalUnits?, remarks? }

        let users = [];
        let densityMode = 'comfortable';
        let showWactContribution = false;

        // Modal / per-element timer state
        let modalLapIndex = null;
        let modalPeriodicIndex = null;   // when timing periodic/change-over items
        let modalStart = 0;
        let modalElapsed = 0;
        let modalRunning = false;
        let modalInterval = null;

        // Manage modal tab
        let currentManageTab = 'areas';
        let manageModalBackdropDown = false;

        // ==================== 2. DEFAULTS & HELPERS ====================
        function formatTime(ms) {
            if (!ms || ms < 0) ms = 0;
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            const hundredths = Math.floor((ms % 1000) / 10);
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
        }

        function calculateStats(observations) {
            if (!observations || observations.length === 0) {
                return { count: 0, avg: 0, std: 0, min: 0, max: 0 };
            }
            const count = observations.length;
            const sum = observations.reduce((a, b) => a + b, 0);
            const avg = sum / count;
            const variance = observations.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / count;
            const std = Math.sqrt(variance);
            return {
                count,
                avg: Math.round(avg),
                std: Math.round(std),
                min: Math.min(...observations),
                max: Math.max(...observations)
            };
        }

        function getAllowance() {
            const input = document.getElementById('allowance-input');
            return input ? (parseFloat(input.value) || 12) : 12;
        }

        function getStandardTime(avgMs, allowancePct) {
            if (!avgMs || avgMs <= 0) return 0;
            return Math.round(avgMs * (1 + (allowancePct / 100)));
        }

        function isRegularElement(lap) {
            return !lap?.workType || lap.workType === 'regular';
        }

        function computeFluctPct(min, max, avg) {
            if (!avg || avg <= 0 || min == null || max == null) return null;
            return Math.round(((max - min) / avg) * 100);
        }

        function formatFluctPctDisplay(min, max, avg) {
            const pct = computeFluctPct(min, max, avg);
            return pct != null ? pct + '%' : '—';
        }

        function getShiftFromUI() {
            const sel = document.getElementById('study-shift');
            const custom = document.getElementById('study-shift-custom')?.value?.trim() || '';
            const shift = sel?.value || 'Day';
            return { shift, shiftCustom: shift === 'Custom' ? custom : '' };
        }

        function getShiftLabel(study) {
            const shift = study?.shift || 'Day';
            if (shift === 'Custom' && study?.shiftCustom) return study.shiftCustom;
            return shift;
        }

        function getStudyAvailableWorkMin(study) {
            const m = study?.metrics || {};
            if (m.taktShiftHours > 0) {
                return Math.max(0, Math.round((m.taktShiftHours * 60) - (m.taktBreaksMin || 0)));
            }
            return null;
        }

        function getLapStats(lap, allowance) {
            if (lap.obsAvg != null && lap.standardTime != null && lap.observations?.length) {
                const stats = calculateStats(lap.observations);
                return {
                    count: lap.obsCount ?? stats.count,
                    avg: lap.obsAvg ?? stats.avg,
                    std: lap.obsStd ?? stats.std,
                    min: stats.min,
                    max: stats.max,
                    standardTime: lap.standardTime
                };
            }
            const stats = calculateStats(lap.observations || []);
            return {
                ...stats,
                standardTime: stats.count > 0 ? getStandardTime(stats.avg, allowance) : null
            };
        }

        function onShiftChange() {
            const wrap = document.getElementById('study-shift-custom-wrap');
            const sel = document.getElementById('study-shift');
            if (wrap) wrap.classList.toggle('hidden', sel?.value !== 'Custom');
            saveToStorage();
        }

        function updateStandardTimes() {
            renderLaps();
            renderCycleObservations();
            saveToStorage();
        }

        function isReadOnlyMode() {
            if (!currentUser) return false;
            if (currentUser.role === 'OPERATOR') return true;
            if (currentUser.role === 'TMO') {
                const currentArea = document.getElementById('area-select')?.value;
                return currentArea && currentArea !== currentUser.assignedCell;
            }
            return false;
        }

        // ==================== 3. STORAGE & PERSISTENCE ====================
        function saveToStorage() {
            localStorage.setItem('stdwork_areas_v20', JSON.stringify(areas));
            localStorage.setItem('stdwork_studies_v20', JSON.stringify(studies));
            localStorage.setItem('stdwork_deleted_studies_v20', JSON.stringify(deletedStudies));
            localStorage.setItem('stdwork_users_v20', JSON.stringify(users));
            localStorage.setItem('stdwork_density_v20', densityMode);
            if (currentUser) {
                localStorage.setItem('stdwork_last_user_v20', JSON.stringify(currentUser));
            }
        }

        function loadFromStorage() {
            const savedAreas = localStorage.getItem('stdwork_areas_v20');
            const savedStudies = localStorage.getItem('stdwork_studies_v20');
            const savedDeleted = localStorage.getItem('stdwork_deleted_studies_v20');
            const savedUsers = localStorage.getItem('stdwork_users_v20');
            const savedDensity = localStorage.getItem('stdwork_density_v20');
            const lastUser = localStorage.getItem('stdwork_last_user_v20');

            if (savedAreas) areas = JSON.parse(savedAreas);
            if (savedStudies) studies = JSON.parse(savedStudies);
            if (savedDeleted) deletedStudies = JSON.parse(savedDeleted);
            if (savedUsers) users = JSON.parse(savedUsers);
            if (savedDensity) densityMode = savedDensity;
            if (lastUser) currentUser = JSON.parse(lastUser);

            // Seed default TMOs if none exist
            if (!users || users.length === 0) {
                users = [];
                const baseAreas = areas.length ? areas : ["ASM02", "ASM05", "ASM07", "ASM11", "ASM55"];
                baseAreas.forEach((area, idx) => {
                    users.push({
                        id: Date.now() + idx,
                        name: 'TMO' + area.replace(/\D/g, '').padStart(2, '0'),
                        role: 'TMO',
                        assignedCell: area
                    });
                });
            }

        }

        // ==================== 4. HEADER OVERFLOW MENU ====================
        function toggleHeaderOverflowMenu() {
            if (window.innerWidth >= 640) return;
            const menu = document.getElementById('header-secondary');
            if (!menu) return;
            const opening = !menu.classList.contains('header-mobile-open');
            closeHeaderOverflowMenu();
            if (opening) {
                menu.classList.add('header-mobile-open', 'flex');
                menu.classList.remove('hidden');
            }
        }

        function closeHeaderOverflowMenu() {
            const menu = document.getElementById('header-secondary');
            if (!menu) return;
            if (window.innerWidth >= 640) {
                menu.classList.remove('header-mobile-open');
                return;
            }
            menu.classList.remove('header-mobile-open', 'flex');
            menu.classList.add('hidden');
        }

        function syncHeaderOverflowToggle() {
            const btn = document.getElementById('header-overflow-toggle');
            if (!btn) return;
            const show = !!currentUser && window.innerWidth < 640;
            btn.classList.toggle('hidden', !show);
            btn.classList.toggle('flex', show);
        }

        function bindHeaderOverflowMenu() {
            if (document.body.dataset.overflowBound) return;
            document.body.dataset.overflowBound = '1';
            document.addEventListener('click', (e) => {
                const wrap = document.getElementById('header-overflow-wrap');
                if (!wrap || window.innerWidth >= 640) return;
                if (!wrap.contains(e.target)) closeHeaderOverflowMenu();
            });
            window.addEventListener('resize', () => {
                syncHeaderOverflowToggle();
                if (window.innerWidth >= 640) {
                    const menu = document.getElementById('header-secondary');
                    if (menu) menu.classList.remove('header-mobile-open', 'hidden');
                } else {
                    closeHeaderOverflowMenu();
                }
            });
        }

        // ==================== 5. LOGIN & ROLE HANDLING ====================
        function toggleAssignedCellField() {
            const field = document.getElementById('assigned-cell-field');
            const role = document.getElementById('login-role').value;
            if (field) {
                field.style.display = (role === 'TMO') ? 'block' : 'none';
            }
        }

        function populateAssignedCellSelect() {
            const sel = document.getElementById('login-assigned-cell');
            if (!sel) return;
            sel.innerHTML = '';
            areas.forEach(area => {
                const opt = document.createElement('option');
                opt.value = area;
                opt.textContent = area;
                sel.appendChild(opt);
            });
        }

        function performLogin() {
            const name = document.getElementById('login-name').value.trim() || "User";
            const role = document.getElementById('login-role').value;
            let assignedCell = null;

            if (role === 'TMO') {
                assignedCell = document.getElementById('login-assigned-cell').value;
            }

            currentUser = { name, role, assignedCell };
            saveToStorage();
            updateUserInfo();

            applyDensity();
            goToRoleHome();
        }

        function updateUserInfo() {
            const badge = document.getElementById('user-info');
            const text = document.getElementById('user-info-text');
            const densityBtn = document.getElementById('density-btn');

            if (!currentUser || !badge || !text) return;

            badge.classList.remove('hidden');
            badge.classList.add('flex');

            let display = `${currentUser.name} • ${currentUser.role}`;
            if (currentUser.assignedCell) display += ` (${currentUser.assignedCell})`;
            text.textContent = display;

            if (densityBtn) densityBtn.classList.toggle('hidden', currentUser.role === 'OPERATOR');
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) { logoutBtn.classList.remove('hidden'); logoutBtn.classList.add('flex'); }
            syncHeaderOverflowToggle();
        }

        function logout() {
            currentUser = null;
            localStorage.removeItem('stdwork_last_user_v20');

            const userInfo = document.getElementById('user-info');
            if (userInfo) userInfo.classList.add('hidden');

            const densityBtn = document.getElementById('density-btn');
            if (densityBtn) densityBtn.classList.add('hidden');

            const logoutBtn = document.getElementById('logout-btn');
            const overflowToggle = document.getElementById('header-overflow-toggle');
            if (logoutBtn) logoutBtn.classList.add('hidden');
            if (overflowToggle) overflowToggle.classList.add('hidden');
            closeHeaderOverflowMenu();

            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            document.getElementById('view-login').classList.remove('hidden');
        }

        function goToRoleHome() {
            if (!currentUser) {
                document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
                document.getElementById('view-login').classList.remove('hidden');
                return;
            }

            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

            if (currentUser.role === 'ADMIN') {
                document.getElementById('view-admin-home').classList.remove('hidden');
            } else if (currentUser.role === 'TMO') {
                document.getElementById('view-tmo-home').classList.remove('hidden');
                const tmoNameEl = document.getElementById('tmo-name');
                const tmoCellEl = document.getElementById('tmo-cell');
                if (tmoNameEl) tmoNameEl.textContent = currentUser.name;
                if (tmoCellEl) tmoCellEl.textContent = currentUser.assignedCell || 'None';
            } else if (currentUser.role === 'OPERATOR') {
                document.getElementById('view-operator-home').classList.remove('hidden');
            }
            applyDensity();
        }

        // ==================== 6. DENSITY MODE ====================
        function applyDensity() {
            const body = document.body;
            const btn = document.getElementById('density-btn');
            const label = document.getElementById('density-label');
            if (!body || !btn || !label) return;

            if (densityMode === 'compact') {
                body.classList.add('density-compact');
                btn.classList.add('bg-emerald-900', 'text-emerald-300');
                label.textContent = 'Comfort';
            } else {
                body.classList.remove('density-compact');
                btn.classList.remove('bg-emerald-900', 'text-emerald-300');
                label.textContent = 'Compact';
            }
        }

        function toggleDensityMode() {
            densityMode = (densityMode === 'compact') ? 'comfortable' : 'compact';
            applyDensity();
            saveToStorage();
        }

        // ==================== 7. CAPTURE VIEW HELPERS ====================
        function onAreaChange() {
            renderLaps();
            renderWorkInstructions();
            updateCopyTemplateButtonVisibility();
            updateOEEPerformanceCard();
        }

        function onStationChange() {
            if (isReadOnlyMode()) return;
            persistCaptureStudyFields();
        }

        function getCaptureMetaFields() {
            const targetParsed = parseFloat(document.getElementById('study-target-output')?.value);
            return {
                observedOperator: document.getElementById('study-observed-operator')?.value?.trim() || '',
                partNumber: document.getElementById('study-part-number')?.value?.trim() || '',
                targetOutput: targetParsed > 0 ? targetParsed : null
            };
        }

        function onCaptureMetaChange() {
            if (isReadOnlyMode()) return;
            persistCaptureStudyFields();
        }

        function syncCaptureMetaReadOnly() {
            const readOnly = isReadOnlyMode();
            ['station-input', 'study-observed-operator', 'study-part-number', 'study-target-output'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                el.disabled = readOnly;
                el.classList.toggle('opacity-60', readOnly);
                el.classList.toggle('cursor-not-allowed', readOnly);
            });
        }

        function getRegularWactTotalMs(allowance) {
            return laps.filter(isRegularElement).reduce((sum, lap) => {
                const st = getLapStats(lap, allowance);
                return sum + (st.standardTime || 0);
            }, 0);
        }

        function toggleWactContribution() {
            showWactContribution = !showWactContribution;
            const btn = document.getElementById('wact-contrib-toggle');
            if (btn) {
                btn.classList.toggle('bg-amber-500', showWactContribution);
                btn.classList.toggle('text-zinc-950', showWactContribution);
                btn.classList.toggle('bg-zinc-800', !showWactContribution);
                btn.classList.toggle('text-zinc-300', !showWactContribution);
                btn.setAttribute('aria-pressed', showWactContribution ? 'true' : 'false');
            }
            renderLaps();
        }

        function getStationLabel(study) {
            const s = (study?.station || '').trim();
            return s || 'Unspecified';
        }

        function groupStudiesByStation(areaStudies) {
            const groups = {};
            areaStudies.forEach(study => {
                const key = getStationLabel(study);
                if (!groups[key]) groups[key] = [];
                groups[key].push(study);
            });
            return groups;
        }

        function persistCaptureStudyFields() {
            if (isReadOnlyMode()) return;
            if (captureStudyId) {
                const study = studies.find(s => s.id === captureStudyId);
                if (study) {
                    study.station = document.getElementById('station-input')?.value?.trim() || '';
                    Object.assign(study, getCaptureMetaFields());
                    study.workInstructions = JSON.parse(JSON.stringify(workInstructions));
                }
            }
            saveToStorage();
        }

        function syncWorkInstructionsCollapseIcon(collapsed) {
            const iconWrap = document.getElementById('work-instructions-collapse-icon');
            if (!iconWrap) return;
            const icon = iconWrap.querySelector('i');
            if (!icon) return;
            icon.classList.toggle('fa-chevron-down', !collapsed);
            icon.classList.toggle('fa-chevron-up', collapsed);
        }

        function initWorkInstructionsCollapse() {
            const body = document.getElementById('work-instructions-body');
            if (!body) return;
            let stored = localStorage.getItem('stdwork_wi_collapsed');
            if (stored === null) stored = window.innerWidth < 640 ? '1' : '0';
            const collapsed = stored === '1';
            body.classList.toggle('hidden', collapsed);
            syncWorkInstructionsCollapseIcon(collapsed);
        }

        function toggleWorkInstructionsSection() {
            const body = document.getElementById('work-instructions-body');
            if (!body) return;
            const collapsed = body.classList.toggle('hidden');
            localStorage.setItem('stdwork_wi_collapsed', collapsed ? '1' : '0');
            syncWorkInstructionsCollapseIcon(collapsed);
        }

        function renderWorkInstructions() {
            const list = document.getElementById('work-instructions-list');
            const addBtn = document.getElementById('add-work-instruction-btn');
            if (!list) return;

            const readOnly = isReadOnlyMode();
            syncCaptureMetaReadOnly();
            if (addBtn) addBtn.classList.toggle('hidden', readOnly);

            list.innerHTML = '';
            if (workInstructions.length === 0) {
                list.innerHTML = '<div class="text-sm text-zinc-500 py-2">No work instructions yet. Add operator steps below (optional).</div>';
                return;
            }

            workInstructions.forEach((instr, idx) => {
                const card = document.createElement('div');
                card.className = 'wi-card bg-zinc-950 border border-zinc-800 rounded-2xl p-4';
                const imageBlock = instr.imageBase64
                    ? `<div class="mt-3 flex flex-wrap items-start gap-2">
                        <img src="${instr.imageBase64}" alt="Instruction ${idx + 1}" class="wi-image-preview">
                        ${readOnly ? '' : `<button type="button" onclick="removeWorkInstructionImage('${instr.id}')" class="text-xs px-3 py-2 text-red-400 hover:text-red-300 rounded-xl min-h-[44px]">Remove image</button>`}
                       </div>`
                    : (readOnly ? '' : `<div class="mt-3">
                        <label class="text-[10px] text-zinc-500 block mb-1">Optional image</label>
                        <input type="file" accept="image/*" onchange="onWorkInstructionImage('${instr.id}', event)" class="text-xs w-full min-h-[44px]">
                       </div>`);

                card.innerHTML = `
                    <div class="flex justify-between items-center gap-2 mb-2">
                        <span class="text-xs font-medium text-zinc-400">Step ${idx + 1}</span>
                        ${readOnly ? '' : `<button type="button" onclick="deleteWorkInstruction('${instr.id}')" class="text-xs px-3 py-2 text-red-400 hover:text-red-300 rounded-xl min-h-[44px]" aria-label="Delete instruction"><i class="fa-solid fa-trash"></i></button>`}
                    </div>
                    ${readOnly ? '' : `<div class="wi-toolbar flex gap-1 mb-2">
                        <button type="button" onmousedown="event.preventDefault()" onclick="formatWorkInstruction('${instr.id}', 'bold')" class="px-3 py-2 text-xs rounded-lg border border-zinc-700 min-h-[44px] min-w-[44px]" title="Bold"><i class="fa-solid fa-bold"></i></button>
                        <button type="button" onmousedown="event.preventDefault()" onclick="formatWorkInstruction('${instr.id}', 'italic')" class="px-3 py-2 text-xs rounded-lg border border-zinc-700 min-h-[44px] min-w-[44px]" title="Italic"><i class="fa-solid fa-italic"></i></button>
                    </div>`}
                    <div contenteditable="${!readOnly}" class="wi-editor px-3 py-2 rounded-xl border border-zinc-700 text-sm outline-none" data-id="${instr.id}">${instr.html || ''}</div>
                    ${imageBlock}
                `;
                list.appendChild(card);

                if (!readOnly) {
                    const editor = card.querySelector('.wi-editor');
                    editor.addEventListener('blur', () => {
                        const item = workInstructions.find(w => w.id === instr.id);
                        if (item) {
                            item.html = editor.innerHTML;
                            persistCaptureStudyFields();
                        }
                    });
                }
            });
        }

        function addWorkInstruction() {
            if (isReadOnlyMode()) return;
            workInstructions.push({ id: 'wi_' + Date.now(), html: '', imageBase64: null });
            renderWorkInstructions();
            persistCaptureStudyFields();
            const body = document.getElementById('work-instructions-body');
            if (body?.classList.contains('hidden')) toggleWorkInstructionsSection();
        }

        function deleteWorkInstruction(id) {
            if (isReadOnlyMode()) return;
            if (!confirm('Delete this instruction step?')) return;
            workInstructions = workInstructions.filter(w => w.id !== id);
            renderWorkInstructions();
            persistCaptureStudyFields();
        }

        function formatWorkInstruction(id, cmd) {
            if (isReadOnlyMode()) return;
            const editor = document.querySelector(`.wi-editor[data-id="${id}"]`);
            if (!editor) return;
            editor.focus();
            document.execCommand(cmd, false, null);
            const item = workInstructions.find(w => w.id === id);
            if (item) {
                item.html = editor.innerHTML;
                persistCaptureStudyFields();
            }
        }

        function onWorkInstructionImage(id, event) {
            if (isReadOnlyMode()) return;
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 800000) {
                alert('Image is too large. Please use a photo under 800 KB to avoid filling browser storage.');
                event.target.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const item = workInstructions.find(w => w.id === id);
                if (item) {
                    item.imageBase64 = reader.result;
                    renderWorkInstructions();
                    persistCaptureStudyFields();
                }
            };
            reader.readAsDataURL(file);
        }

        function removeWorkInstructionImage(id) {
            if (isReadOnlyMode()) return;
            const item = workInstructions.find(w => w.id === id);
            if (item) {
                item.imageBase64 = null;
                renderWorkInstructions();
                persistCaptureStudyFields();
            }
        }

        function updateOEEPerformanceCard() {
            const perfEl = document.getElementById('oee-performance');
            const detailEl = document.getElementById('oee-detail');
            if (!perfEl || !detailEl) return;

            const wact = getCurrentWACT();
            const takt = parseFloat(document.getElementById('takt-time-display')?.textContent) || 0;

            if (wact > 0 && takt > 0) {
                const performance = Math.round((takt / wact) * 100);
                perfEl.textContent = performance + '%';

                if (performance >= 95) {
                    perfEl.className = 'text-3xl font-semibold font-mono text-emerald-400';
                    detailEl.textContent = 'Station meets Takt — good capability';
                } else if (performance >= 85) {
                    perfEl.className = 'text-3xl font-semibold font-mono text-amber-400';
                    detailEl.textContent = 'Station close to Takt — monitor';
                } else {
                    perfEl.className = 'text-3xl font-semibold font-mono text-red-400';
                    detailEl.textContent = 'Station behind Takt — review elements';
                }
            } else {
                perfEl.textContent = '—';
                perfEl.className = 'text-3xl font-semibold font-mono text-emerald-400';
                detailEl.textContent = 'This station vs Takt';
            }
        }

        function computeTaktSeconds(demand, shiftHrs, breaksMin) {
            if (demand <= 0 || shiftHrs <= 0) return null;
            const availableSec = (shiftHrs * 3600) - (breaksMin * 60);
            if (availableSec <= 0) return null;
            return Math.round(availableSec / demand);
        }

        function getStudyWACT(study) {
            const allowance = study.allowancePct || 12;
            if (study.workflowMode === 'cycles' && study.cycleTimes?.length > 0) {
                const avg = study.cycleTimes.reduce((a, b) => a + b, 0) / study.cycleTimes.length;
                return getStandardTime(Math.round(avg), allowance);
            }
            if (study.laps?.length > 0) {
                let total = 0;
                let hasObs = false;
                study.laps.forEach(lap => {
                    if (!isRegularElement(lap)) return;
                    const st = calculateStats(lap.observations || []);
                    if (st.count > 0) {
                        hasObs = true;
                        total += getStandardTime(st.avg, allowance);
                    }
                });
                if (hasObs) return total;
            }
            return study.totalTime > 0 ? Math.round(study.totalTime) : 0;
        }

        function getStudyMetrics(study) {
            const wactSec = study.metrics?.wactSec ?? getStudyWACT(study);
            const taktSec = study.metrics?.taktSec ?? null;
            let headroomPct = study.metrics?.headroomPct ?? null;
            if (headroomPct === null && wactSec > 0 && taktSec > 0) {
                headroomPct = Math.round((1 - wactSec / taktSec) * 100);
            }
            return { wactSec, taktSec, headroomPct };
        }

        function getCurrentWACT() {
            const allowance = getAllowance();
            if (workflowMode === 'cycles' && cycleTimes.length > 0) {
                const avg = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
                return getStandardTime(Math.round(avg), allowance);
            }
            if (laps.length > 0) {
                let total = 0;
                let hasObs = false;
                laps.forEach(lap => {
                    if (!isRegularElement(lap)) return;
                    const st = calculateStats(lap.observations || []);
                    if (st.count > 0) {
                        hasObs = true;
                        total += getStandardTime(st.avg, allowance);
                    }
                });
                if (hasObs) return total;
            }
            return elapsedTime > 0 ? Math.round(elapsedTime) : 0;
        }

        function updateCopyTemplateButtonVisibility() {
            const btn = document.getElementById('copy-template-btn');
            if (!btn) return;
            const hasStudies = studies.length > 0;
            const isElementsMode = workflowMode === 'elements';
            const canEdit = !isReadOnlyMode();
            btn.classList.toggle('hidden', !(hasStudies && isElementsMode && canEdit));
        }

        // ==================== 8. RENDERING - LAPS / ELEMENTS ====================
        function renderLaps() {
            const tbody = document.getElementById('laps-body');
            if (!tbody) return;
            tbody.innerHTML = '';

            const isCycleMode = workflowMode === 'cycles';
            const readOnly = isReadOnlyMode();
            const allowance = getAllowance();
            const totalWactMs = showWactContribution ? getRegularWactTotalMs(allowance) : 0;

            laps.forEach((lap, index) => {
                const stats = calculateStats(lap.observations || []);
                const lapStats = getLapStats(lap, allowance);
                const hasObservations = stats.count > 0;
                const standardTime = lapStats.standardTime || 0;
                const workType = lap.workType || 'regular';
                const isNonRegular = workType !== 'regular';

                // Variance badge — obs variability (range as % of avg). High values = good Kaizen candidates.
                let varianceHTML = `<span class="text-xs text-zinc-500">—</span>`;
                if (hasObservations && stats.count >= 2 && stats.avg > 0) {
                    const rangePct = computeFluctPct(stats.min, stats.max, stats.avg);
                    const colorClass = rangePct > 25 ? 'text-red-400' : (rangePct > 12 ? 'text-amber-400' : 'text-emerald-400');
                    varianceHTML = `<div class="variance-badge ${colorClass} bg-zinc-950 border border-zinc-700" title="FLUCT % (range ÷ avg)">${rangePct}%</div>`;
                } else if (hasObservations) {
                    varianceHTML = `<div class="variance-badge text-zinc-400 bg-zinc-950 border border-zinc-700">1 obs</div>`;
                }

                const lowHigh = hasObservations
                    ? `${formatTime(stats.min)} / ${formatTime(stats.max)}`
                    : '— / —';

                const tr = document.createElement('tr');
                const isNextElementLap = isCycleMode && index === cycleElementLapIndex && cycleElementLapIndex < laps.length;
                tr.className = `hover:bg-zinc-800/60${isNonRegular ? ' bg-amber-950/20' : ''}${isNextElementLap ? ' bg-amber-500/10 ring-1 ring-inset ring-amber-500/40' : ''}`;

                const canEditName = !readOnly;
                const deleteButton = (readOnly || isCycleMode) ? '' :
                    `<button onclick="deleteElement(${index})" class="text-xs px-2 py-1.5 text-red-400 hover:text-red-500" title="Delete element" aria-label="Delete element"><i class="fa-solid fa-trash"></i></button>`;

                const typeSelect = (readOnly || isCycleMode) ?
                    `<span class="text-[10px] uppercase tracking-wide text-zinc-500">${workType === 'regular' ? '—' : workType}</span>` :
                    `<select onchange="setElementWorkType(${index}, this.value)" class="element-type-select bg-zinc-950 border border-zinc-700 rounded-lg px-1.5 py-1 text-[10px] min-h-[32px] max-w-[6.5rem]" title="Mark periodic or change-over work (excluded from WACT)">
                        <option value="regular" ${workType === 'regular' ? 'selected' : ''}>Regular</option>
                        <option value="periodic" ${workType === 'periodic' ? 'selected' : ''}>Periodic</option>
                        <option value="changeover" ${workType === 'changeover' ? 'selected' : ''}>Change-over</option>
                    </select>`;

                const mobileSummary = `<div class="sm:hidden text-[10px] text-zinc-500 font-mono mt-1 leading-snug">Split ${formatTime(lap.split)} · Low/High ${lowHigh} · Std ${hasObservations ? formatTime(standardTime) : '—'}</div>`;

                let contribHTML = '';
                if (showWactContribution && isRegularElement(lap) && hasObservations && totalWactMs > 0) {
                    const pct = Math.round((standardTime / totalWactMs) * 100);
                    contribHTML = `<div class="mt-1.5 flex items-center gap-2 max-w-[12rem]" title="${pct}% of total WACT">
                        <div class="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden min-w-[3rem]">
                            <div class="h-full bg-amber-500 rounded-full" style="width:${pct}%"></div>
                        </div>
                        <span class="text-[10px] text-zinc-500 font-mono shrink-0">${pct}%</span>
                    </div>`;
                }

                tr.innerHTML = `
                    <td class="py-2 px-2 sm:py-3 sm:px-5 font-mono text-amber-400 w-8 sm:w-10">${lap.number}</td>
                    <td class="py-2 px-2 sm:py-3 sm:px-5 min-w-0">
                        <div contenteditable="${canEditName}" class="element-name px-2 sm:px-3 py-1 rounded-lg border border-transparent hover:border-zinc-700 focus:border-amber-500 min-h-[28px] outline-none text-xs sm:text-sm" data-index="${index}">${lap.name || ''}</div>
                        ${contribHTML}
                        ${mobileSummary}
                    </td>
                    <td class="hidden sm:table-cell py-2 px-2 sm:py-3 sm:px-5">${typeSelect}</td>
                    <td class="hidden sm:table-cell py-2 px-2 sm:py-3 sm:px-5 font-mono">${formatTime(lap.split)}</td>
                    <td class="hidden md:table-cell py-2 px-2 sm:py-3 sm:px-5 font-mono text-xs text-zinc-400">${lowHigh}</td>
                    <td class="py-2 px-2 sm:py-3 sm:px-5 font-mono text-emerald-400">${hasObservations ? formatTime(standardTime) : '—'}</td>
                    <td class="hidden sm:table-cell py-2 px-2 sm:py-3 sm:px-5">${varianceHTML}</td>
                    <td class="py-2 px-2 sm:py-3 sm:px-5 text-right w-14 sm:w-20">
                        <button onclick="openElementalModal(${index})" class="text-xs px-2 sm:px-3 py-1.5 bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 rounded-xl mr-1 min-h-[36px] min-w-[36px]" title="Time observations for this element" aria-label="Time observations"><i class="fa-solid fa-clock"></i></button>
                        ${deleteButton}
                    </td>
                `;
                tbody.appendChild(tr);

                if (canEditName) {
                    const nameEl = tr.querySelector('.element-name');
                    nameEl.addEventListener('blur', () => {
                        laps[index].name = nameEl.textContent.trim();
                        saveToStorage();
                    });
                    nameEl.addEventListener('keydown', e => {
                        if (e.key === 'Enter') nameEl.blur();
                    });
                }
            });

            updateStats();
            updateFinalizeSection();
            refreshTAKT();
            updateOEEPerformanceCard();
            updateCopyTemplateButtonVisibility();
            renderCycleObservations();
            renderPeriodicWork();
            updateCycleElementLapUI();
            syncCaptureMetaReadOnly();
        }

        function getElementCycleTotal() {
            if (!laps.length) return 0;
            return laps.reduce((sum, l) => sum + (l.split || 0), 0);
        }

        function renderCycleObservations() {
            const section = document.getElementById('cycle-observations-section');
            const list = document.getElementById('cycle-list');
            const summary = document.getElementById('cycle-standard-summary');
            if (!section || !list) return;

            const elementCycleTotal = getElementCycleTotal();
            const pendingElementCycle = workflowMode === 'cycles' && cycleTimes.length === 0 &&
                (elementCycleTotal > 0 || elapsedTime > 0);

            if (workflowMode !== 'cycles' && cycleTimes.length === 0) {
                section.classList.add('hidden');
                return;
            }
            section.classList.remove('hidden');

            const countEl = document.getElementById('cycle-count');
            if (countEl) {
                countEl.textContent = cycleTimes.length > 0
                    ? `${cycleTimes.length} cycle${cycleTimes.length === 1 ? '' : 's'}`
                    : (pendingElementCycle ? 'Element cycle ready' : '0 cycles');
            }

            list.innerHTML = '';

            if (pendingElementCycle) {
                const pendingTime = elapsedTime > 0 ? elapsedTime : elementCycleTotal;
                const hint = document.createElement('div');
                hint.className = 'text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800 rounded-2xl p-3 mb-2';
                hint.innerHTML = `<strong>Element cycle ready:</strong> ${formatTime(pendingTime)} — press <strong>RECORD CYCLE</strong> to save as Cycle #1.`;
                list.appendChild(hint);
            }

            const readOnly = isReadOnlyMode();
            cycleTimes.forEach((time, i) => {
                const div = document.createElement('div');
                div.className = 'flex justify-between px-3 py-1 hover:bg-zinc-800 rounded text-xs items-center';
                const label = (i === 0 && laps.length > 0) ? `Cycle ${i + 1} (from elements)` : `Cycle ${i + 1}`;
                const deleteBtn = readOnly ? '' :
                    `<button onclick="deleteCycleTime(${i}); event.stopImmediatePropagation()" class="text-red-400 hover:text-red-500 px-2 py-0.5">×</button>`;
                div.innerHTML = `<span>${label}: <span class="font-semibold">${formatTime(time)}</span></span>${deleteBtn}`;
                list.appendChild(div);
            });

            if (summary) {
                if (cycleTimes.length > 0) {
                    const avg = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
                    const allowance = getAllowance();
                    const standard = getStandardTime(avg, allowance);
                    const avgEl = document.getElementById('cycle-avg-time');
                    const stdEl = document.getElementById('cycle-standard-time');
                    if (avgEl) avgEl.textContent = formatTime(Math.round(avg));
                    if (stdEl) stdEl.textContent = formatTime(standard) + ` (+${allowance}%)`;
                    summary.style.display = '';
                } else {
                    summary.style.display = 'none';
                }
            }

            updateFinalizeSection();
            refreshTAKT();
        }

        function deleteCycleTime(index) {
            if (isReadOnlyMode()) return;
            if (!confirm('Delete this cycle observation?')) return;
            cycleTimes.splice(index, 1);
            renderCycleObservations();
            updateStats();
            saveToStorage();
        }

        function updateStats() {
            const lapCountEl = document.getElementById('lap-count');
            const totalTimeEl = document.getElementById('total-time');
            const avgCycleEl = document.getElementById('avg-cycle');
            const fluctEl = document.getElementById('fluct-display');
            const fluctPctEl = document.getElementById('fluct-pct');

            if (lapCountEl) {
                lapCountEl.textContent = workflowMode === 'cycles'
                    ? (cycleTimes.length || (getElementCycleTotal() > 0 ? 1 : 0))
                    : laps.length;
            }

            const totalMs = elapsedTime || (isRunning ? Date.now() - startTime : 0);
            if (totalTimeEl) totalTimeEl.textContent = formatTime(totalMs);

            if (workflowMode === 'cycles' && cycleTimes.length > 0) {
                const avg = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
                if (avgCycleEl) avgCycleEl.textContent = formatTime(Math.round(avg));
                if (fluctEl && cycleTimes.length > 1) {
                    const max = Math.max(...cycleTimes);
                    const min = Math.min(...cycleTimes);
                    fluctEl.textContent = formatTime(max - min);
                    if (fluctPctEl) fluctPctEl.textContent = 'FLUCT % ' + formatFluctPctDisplay(min, max, Math.round(avg));
                } else {
                    if (fluctEl) fluctEl.textContent = '—';
                    if (fluctPctEl) fluctPctEl.textContent = '';
                }
            } else if (laps.length > 0) {
                // Simple element-based avg for display
                let total = 0;
                let count = 0;
                laps.forEach(l => {
                    const st = calculateStats(l.observations || []);
                    if (st.count > 0) { total += st.avg; count++; }
                });
                if (count > 0 && avgCycleEl) avgCycleEl.textContent = formatTime(Math.round(total / count));
            } else {
                if (avgCycleEl) avgCycleEl.textContent = '—';
                if (fluctEl) fluctEl.textContent = '—';
                if (fluctPctEl) fluctPctEl.textContent = '';
            }
        }

        function updateFinalizeSection() {
            const section = document.getElementById('finalize-section');
            if (!section) return;
            const hasData = laps.length > 0 || cycleTimes.length > 0;
            section.classList.toggle('hidden', !hasData || isReadOnlyMode());
        }

        // ==================== 9. TIMER LOGIC ====================
        function toggleStartPause() {
            if (isReadOnlyMode()) return;
            const btn = document.getElementById('start-pause-btn');
            const text = document.getElementById('start-pause-text');

            if (!isRunning) {
                startTime = Date.now() - elapsedTime;
                timerInterval = setInterval(updateMainTimer, 10);
                isRunning = true;
                if (btn) {
                    btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
                    btn.classList.add('bg-red-600', 'hover:bg-red-500');
                }
                if (text) text.textContent = 'PAUSE';
            } else {
                clearInterval(timerInterval);
                elapsedTime = Date.now() - startTime;
                isRunning = false;
                if (btn) {
                    btn.classList.remove('bg-red-600', 'hover:bg-red-500');
                    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
                }
                if (text) text.textContent = 'RESUME';
            }
            updateCycleElementLapUI();
        }

        function updateMainTimer() {
            const display = document.getElementById('timer-display');
            if (display) {
                const current = Date.now() - startTime;
                display.textContent = formatTime(current);
            }
            if (workflowMode === 'cycles') updateCycleElementLapUI();
        }

        function getMainTimerElapsed() {
            if (isRunning) return Date.now() - startTime;
            return elapsedTime;
        }

        function resetCycleElementLapPointer() {
            cycleElementLapIndex = 0;
            cycleElementLapAnchor = 0;
            updateCycleElementLapUI();
        }

        function updateCycleElementLapUI() {
            const indicator = document.getElementById('cycle-element-lap-indicator');
            const elLapBtn = document.getElementById('element-lap-btn');
            const showCyclesExtras = workflowMode === 'cycles' && !isReadOnlyMode();

            if (elLapBtn) {
                elLapBtn.classList.toggle('hidden', !showCyclesExtras || laps.length === 0);
            }
            if (!indicator) return;

            if (!showCyclesExtras || laps.length === 0) {
                indicator.classList.add('hidden');
                return;
            }

            indicator.classList.remove('hidden');
            const numEl = document.getElementById('cycle-next-element-num');
            const totalEl = document.getElementById('cycle-next-element-total');
            const nameEl = document.getElementById('cycle-next-element-name');
            const statusEl = document.getElementById('cycle-next-element-status');

            if (totalEl) totalEl.textContent = laps.length;

            if (cycleElementLapIndex >= laps.length) {
                if (numEl) numEl.textContent = laps.length;
                if (nameEl) nameEl.textContent = '—';
                if (statusEl) statusEl.textContent = 'All elements logged this cycle — press RECORD CYCLE to finish.';
                if (elLapBtn) {
                    elLapBtn.disabled = true;
                    elLapBtn.classList.add('opacity-50', 'cursor-not-allowed');
                }
                return;
            }

            const nextLap = laps[cycleElementLapIndex];
            const isLastElement = laps.length > 1 && cycleElementLapIndex === laps.length - 1;
            if (elLapBtn) {
                const canLap = cycleElementLapIndex < laps.length && !isLastElement && getMainTimerElapsed() > cycleElementLapAnchor;
                elLapBtn.disabled = !canLap;
                elLapBtn.classList.toggle('opacity-50', !canLap);
                elLapBtn.classList.toggle('cursor-not-allowed', !canLap);
            }
            if (numEl) numEl.textContent = nextLap.number || (cycleElementLapIndex + 1);
            if (nameEl) nameEl.textContent = nextLap.name || `Element ${cycleElementLapIndex + 1}`;
            if (statusEl) {
                statusEl.textContent = isLastElement
                    ? 'Final element — press RECORD CYCLE to finish this cycle.'
                    : 'Element Lap records a split observation to this element.';
            }
        }

        function handleElementLapInCycles() {
            if (isReadOnlyMode() || workflowMode !== 'cycles') return;
            if (!laps.length) {
                alert('Define elements first in Define Elements mode, then switch to Time Cycles.');
                return;
            }
            if (cycleElementLapIndex >= laps.length) return;

            const currentElapsed = getMainTimerElapsed();
            const splitTime = currentElapsed - cycleElementLapAnchor;
            if (splitTime <= 0) return;

            const lap = laps[cycleElementLapIndex];
            if (!lap.observations) lap.observations = [];
            lap.observations.push(splitTime);

            cycleElementLapAnchor = currentElapsed;
            cycleElementLapIndex++;

            renderLaps();
            updateCycleElementLapUI();
            saveToStorage();
            refreshTAKT();
        }

        function recordCycleTime() {
            let cycleTimeToSave = 0;

            if (isRunning) {
                cycleTimeToSave = Date.now() - startTime;
            } else if (elapsedTime > 0) {
                cycleTimeToSave = elapsedTime;
            } else if (laps.length > 0) {
                cycleTimeToSave = getElementCycleTotal();
            }

            if (cycleTimeToSave <= 0) return;

            let finalObsRecorded = false;
            if (workflowMode === 'cycles' && laps.length > 0 && cycleElementLapIndex < laps.length) {
                const currentElapsed = getMainTimerElapsed();
                const finalSplit = currentElapsed - cycleElementLapAnchor;
                if (finalSplit > 0) {
                    const lastLap = laps[cycleElementLapIndex];
                    if (!lastLap.observations) lastLap.observations = [];
                    lastLap.observations.push(finalSplit);
                    finalObsRecorded = true;
                }
            }

            cycleTimes.push(cycleTimeToSave);
            resetCycleElementLapPointer();

            const now = Date.now();
            if (isRunning) {
                startTime = now;
            } else {
                elapsedTime = 0;
                const spBtn = document.getElementById('start-pause-btn');
                const spText = document.getElementById('start-pause-text');
                if (spBtn) {
                    spBtn.classList.remove('bg-red-600', 'hover:bg-red-500');
                    spBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
                }
                if (spText) spText.textContent = 'START';
            }

            const display = document.getElementById('timer-display');
            const totalDisplay = document.getElementById('total-time');
            if (display) display.textContent = '00:00.00';
            if (totalDisplay) totalDisplay.textContent = '00:00.00';

            if (finalObsRecorded) {
                renderLaps();
            } else {
                renderCycleObservations();
                updateStats();
            }
        }

        function handleLapButton() {
            if (isReadOnlyMode()) return;

            if (workflowMode === 'elements') {
                if (!isRunning) return;

                const now = Date.now();
                const currentElapsed = now - startTime;
                const previousTotal = laps.reduce((sum, l) => sum + (l.split || 0), 0);
                const splitTime = currentElapsed - previousTotal;

                laps.push({
                    number: laps.length + 1,
                    name: `Element ${laps.length + 1}`,
                    split: splitTime,
                    observations: [],
                    workType: 'regular'
                });
                renderLaps();
            } else {
                recordCycleTime();
            }
            saveToStorage();
            refreshTAKT();
        }

        function cycleReset() {
            if (isReadOnlyMode()) return;
            clearInterval(timerInterval);
            timerInterval = null;
            isRunning = false;
            elapsedTime = 0;
            startTime = 0;

            const display = document.getElementById('timer-display');
            if (display) display.textContent = '00:00.00';

            const btn = document.getElementById('start-pause-btn');
            const text = document.getElementById('start-pause-text');
            if (btn) {
                btn.classList.remove('bg-red-600', 'hover:bg-red-500');
                btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
            }
            if (text) text.textContent = 'START';

            if (workflowMode === 'cycles') {
                resetCycleElementLapPointer();
            }
        }

        // ==================== 10. STUDY FINALIZE & DELETE (with Audit) ====================
        function finalizeAndSaveStudy() {
            if (isReadOnlyMode()) {
                alert('Read-only — cannot save changes.');
                return;
            }
            const area = document.getElementById('area-select').value || 'Unspecified';
            const station = document.getElementById('station-input')?.value?.trim() || '';
            const name = document.getElementById('study-name').value.trim() || 'Untitled Study';
            const allowance = getAllowance();
            const wiCopy = JSON.parse(JSON.stringify(workInstructions));

            let totalTimeToSave = elapsedTime || (isRunning ? Date.now() - startTime : 0);
            if (workflowMode === 'cycles' && cycleTimes.length > 0) {
                totalTimeToSave = cycleTimes.reduce((sum, t) => sum + t, 0);
            }

            const { shift, shiftCustom } = getShiftFromUI();

            const elementsWithStandards = laps.map(lap => {
                const st = calculateStats(lap.observations || []);
                return {
                    ...lap,
                    standardTime: st.count > 0 ? getStandardTime(st.avg, allowance) : null,
                    obsCount: st.count,
                    obsAvg: st.avg,
                    obsStd: st.std,
                    obsMin: st.count > 0 ? st.min : null,
                    obsMax: st.count > 0 ? st.max : null
                };
            });

            const demand = parseFloat(document.getElementById('takt-demand')?.value) || 0;
            const shiftHrs = parseFloat(document.getElementById('takt-shift-hours')?.value) || 0;
            const breaksMin = parseFloat(document.getElementById('takt-breaks-min')?.value) || 0;
            const wactSec = getCurrentWACT();
            const taktSec = computeTaktSeconds(demand, shiftHrs, breaksMin);
            let headroomPct = null;
            if (wactSec > 0 && taktSec > 0) {
                headroomPct = Math.round((1 - wactSec / taktSec) * 100);
            }

            const studyPayload = {
                studyName: name,
                area,
                station,
                ...getCaptureMetaFields(),
                shift,
                shiftCustom,
                date: document.getElementById('study-date').value || new Date().toISOString().split('T')[0],
                totalTime: totalTimeToSave,
                allowancePct: allowance,
                laps: elementsWithStandards,
                cycleTimes: [...cycleTimes],
                periodicWorkItems: JSON.parse(JSON.stringify(periodicWorkItems)),
                workflowMode: workflowMode,
                workInstructions: wiCopy,
                ownerCell: area,
                metrics: { wactSec, taktSec, headroomPct, taktDemand: demand, taktShiftHours: shiftHrs, taktBreaksMin: breaksMin }
            };

            if (captureStudyId) {
                const idx = studies.findIndex(s => s.id === captureStudyId);
                if (idx >= 0) {
                    studies[idx] = {
                        ...studies[idx],
                        ...studyPayload,
                        history: studies[idx].history || []
                    };
                }
            } else {
                studies.unshift({
                    id: Date.now(),
                    ...studyPayload,
                    createdBy: currentUser?.name || 'Unknown',
                    createdByRole: currentUser?.role || 'Unknown',
                    history: []
                });
            }
            saveToStorage();
            alert('Study saved with standard times and history tracking!');
            goToRoleHome();
        }

        function deleteStudy(studyId) {
            if (!currentUser) return;

            const study = studies.find(s => s.id === studyId);
            if (!study) return;

            const isOwner = currentUser.role === 'TMO' && study.ownerCell === currentUser.assignedCell;
            if (currentUser.role !== 'ADMIN' && !isOwner) {
                alert('You do not have permission to delete this study.');
                return;
            }

            pendingDeleteStudyId = studyId;

            if (currentUser.role === 'TMO') {
                // TMO must provide reason
                const modal = document.getElementById('delete-reason-modal');
                modal.classList.remove('hidden');
                modal.classList.add('flex');
                document.getElementById('delete-reason-input').value = '';
                document.getElementById('delete-reason-input').focus();
            } else {
                if (confirm('Move this study to the Admin Audit Log for recovery?')) {
                    performSoftDelete(studyId, 'Deleted by Admin (no reason provided)');
                }
            }
        }

        function confirmDeleteWithReason() {
            const reasonInput = document.getElementById('delete-reason-input');
            const reason = reasonInput.value.trim();
            if (!reason) {
                alert('Please provide a reason for deletion.');
                return;
            }
            performSoftDelete(pendingDeleteStudyId, reason);
            closeDeleteReasonModal();
        }

        function performSoftDelete(studyId, reason) {
            const idx = studies.findIndex(s => s.id === studyId);
            if (idx === -1) return;

            const study = studies[idx];
            const deletedEntry = {
                ...study,
                deletedBy: currentUser.name,
                deletedByRole: currentUser.role,
                deletedAt: new Date().toISOString(),
                deleteReason: reason
            };

            deletedStudies.unshift(deletedEntry);
            studies.splice(idx, 1);
            saveToStorage();
            renderStudiesList();
            alert('Study moved to Admin Audit Log. It can be recovered by an Administrator.');
        }

        function closeDeleteReasonModal() {
            const modal = document.getElementById('delete-reason-modal');
            modal.classList.remove('flex');
            modal.classList.add('hidden');
            pendingDeleteStudyId = null;
        }

        function showAuditLog() {
            if (!currentUser || currentUser.role !== 'ADMIN') return;

            const modal = document.getElementById('audit-log-modal');
            const content = document.getElementById('audit-log-content');
            content.innerHTML = '';

            if (deletedStudies.length === 0) {
                content.innerHTML = `<div class="text-zinc-500 py-8 text-center">No deleted studies in the audit log.</div>`;
            } else {
                deletedStudies.forEach((entry, index) => {
                    const div = document.createElement('div');
                    div.className = 'bg-zinc-950 border border-zinc-700 rounded-2xl p-4 mb-3';
                    div.innerHTML = `
                        <div class="flex justify-between items-start">
                            <div>
                                <div class="font-semibold">${entry.studyName} <span class="text-xs text-zinc-500">(${entry.area})</span></div>
                                <div class="text-xs text-zinc-400 mt-0.5">Deleted by ${entry.deletedBy} (${entry.deletedByRole}) on ${new Date(entry.deletedAt).toLocaleString()}</div>
                                <div class="text-xs text-amber-400 mt-1">Reason: ${entry.deleteReason}</div>
                            </div>
                            <div class="flex gap-2">
                                <button onclick="recoverStudy(${index}); event.stopImmediatePropagation()" class="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white">Recover</button>
                                <button onclick="permanentDeleteFromAudit(${index}); event.stopImmediatePropagation()" class="px-4 py-1.5 text-xs bg-red-600 hover:bg-red-500 rounded-xl text-white">Delete Forever</button>
                            </div>
                        </div>
                    `;
                    content.appendChild(div);
                });
            }
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        function recoverStudy(deletedIndex) {
            if (!confirm('Recover this study back to active studies?')) return;

            const entry = deletedStudies[deletedIndex];
            const { deletedBy, deletedByRole, deletedAt, deleteReason, ...restored } = entry;
            studies.unshift(restored);
            deletedStudies.splice(deletedIndex, 1);
            saveToStorage();
            closeAuditLogModal();
            renderStudiesList();
            alert('Study recovered successfully.');
        }

        function permanentDeleteFromAudit(deletedIndex) {
            if (!confirm('Permanently delete this record? This cannot be undone.')) return;
            deletedStudies.splice(deletedIndex, 1);
            saveToStorage();
            showAuditLog();
        }

        function closeAuditLogModal() {
            const modal = document.getElementById('audit-log-modal');
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }

        // ==================== 11. STUDIES LIST ====================
        function populateStudiesAreaFilter() {
            const sel = document.getElementById('studies-area-filter');
            if (!sel) return;
            const current = sel.value;
            sel.innerHTML = '<option value="">All Areas</option>';
            areas.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = a;
                sel.appendChild(opt);
            });
            if (current && areas.includes(current)) sel.value = current;
        }

        function getFilteredStudiesForList() {
            let filtered = studies;
            if (currentUser?.role === 'TMO' && currentUser.assignedCell) {
                filtered = studies.filter(s => s.ownerCell === currentUser.assignedCell);
            }

            const areaFilter = document.getElementById('studies-area-filter');
            const areaVal = areaFilter ? areaFilter.value : '';
            if (areaVal) {
                filtered = filtered.filter(s => s.area === areaVal);
            }

            const searchInput = document.getElementById('studies-search');
            const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
            if (term) {
                filtered = filtered.filter(s =>
                    (s.studyName || '').toLowerCase().includes(term) ||
                    (s.area || '').toLowerCase().includes(term)
                );
            }
            return filtered;
        }

        function renderStudiesList() {
            const container = document.getElementById('studies-list');
            if (!container) return;
            container.innerHTML = '';

            populateStudiesAreaFilter();

            const lineReportBtn = document.getElementById('studies-line-report-btn');
            if (lineReportBtn) {
                lineReportBtn.classList.toggle('hidden', !currentUser || currentUser.role !== 'ADMIN');
                if (currentUser?.role === 'ADMIN') lineReportBtn.classList.add('flex');
            }

            const filtered = getFilteredStudiesForList();

            if (filtered.length === 0) {
                container.innerHTML = `<div class="text-zinc-500 text-center py-8">No studies match your filters.</div>`;
                return;
            }

            filtered.forEach(study => {
                const isOwner = currentUser?.role === 'TMO' && study.ownerCell === currentUser.assignedCell;
                const canEdit = currentUser && (currentUser.role === 'ADMIN' || isOwner);
                const canDelete = canEdit;

                const div = document.createElement('div');
                div.className = `studies-card bg-zinc-900 border ${canEdit ? 'border-zinc-700 hover:border-amber-500/50' : 'border-zinc-800'} rounded-3xl p-5 mb-3 transition-colors`;

                const modeLabel = study.workflowMode === 'cycles'
                    ? `<span class="text-xs px-2 py-0.5 rounded bg-emerald-900 text-emerald-300">CYCLES</span>`
                    : `<span class="text-xs px-2 py-0.5 rounded bg-amber-900 text-amber-300">ELEMENTS</span>`;

                div.innerHTML = `
                    <div class="flex justify-between items-start gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="font-semibold flex items-center gap-x-2 flex-wrap">${study.studyName} ${modeLabel}</div>
                            <div class="text-sm text-zinc-400 mt-0.5">${study.area}${study.station ? ' • ' + study.station : ''} • ${study.laps?.length || 0} elements • ${study.allowancePct || 12}% allowance</div>
                            <div class="text-xs text-zinc-500 mt-1">by ${study.createdBy} • ${study.date || ''}</div>
                        </div>
                        <div class="flex flex-col sm:flex-row gap-2 items-end">
                            <button onclick="loadStudyIntoCapture(${study.id}, ${canEdit})" class="px-4 py-2 ${canEdit ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'} rounded-2xl text-sm whitespace-nowrap">
                                ${canEdit ? 'Load & Edit' : 'View Only'}
                            </button>
                            <div class="flex gap-1">
                                ${canDelete ? `<button onclick="deleteStudy(${study.id}); event.stopImmediatePropagation()" class="px-3 py-2 bg-red-900/60 hover:bg-red-600 text-red-300 rounded-2xl text-xs flex items-center gap-x-1" title="Delete study (moves to Audit Log for recovery)" aria-label="Delete study"><i class="fa-solid fa-trash"></i></button>` : ''}
                                <button onclick="exportStudyJSON(${study.id}); event.stopImmediatePropagation();" class="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-xs" title="Export this study as JSON" aria-label="Export study as JSON"><i class="fa-solid fa-file-code"></i></button>
                                <button onclick="exportStudyCSV(${study.id}); event.stopImmediatePropagation();" class="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-xs" title="Export this study as CSV (elements/cycles)" aria-label="Export study as CSV"><i class="fa-solid fa-file-csv"></i></button>
                                <button onclick="openStandardizationDocumentFromStudy(${study.id}); event.stopImmediatePropagation();" class="px-3 py-2 bg-zinc-800 hover:bg-amber-500/20 hover:border-amber-500/50 rounded-2xl text-xs border border-transparent" title="Generate Standardization Document" aria-label="Generate Standardization Document"><i class="fa-solid fa-file-lines text-amber-400"></i></button>
                            </div>
                        </div>
                    </div>
                `;
                container.appendChild(div);
            });
        }

        function filterStudiesList() {
            renderStudiesList();
        }

        // ==================== 12. CAPTURE HELPERS (NEW / RESTORED) ====================
        function refreshAreaSelect() {
            const sel = document.getElementById('area-select');
            if (!sel) return;
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">Select area / station...</option>';
            areas.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = a;
                sel.appendChild(opt);
            });
            if (currentVal && areas.includes(currentVal)) sel.value = currentVal;
        }

        function populateCaptureAreas() {
            refreshAreaSelect();
        }

        function resetCaptureState() {
            // Stop any running timers
            if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
            if (modalInterval) { clearInterval(modalInterval); modalInterval = null; }

            laps = [];
            cycleTimes = [];
            workInstructions = [];
            periodicWorkItems = [];
            captureStudyId = null;
            elapsedTime = 0;
            startTime = 0;
            isRunning = false;
            workflowMode = 'elements';
            cycleElementLapIndex = 0;
            cycleElementLapAnchor = 0;

            // Reset UI fields safely
            const studyName = document.getElementById('study-name');
            const stationInput = document.getElementById('station-input');
            const timer = document.getElementById('timer-display');
            const total = document.getElementById('total-time');
            const lapCount = document.getElementById('lap-count');
            const avg = document.getElementById('avg-cycle');
            const finalize = document.getElementById('finalize-section');
            const allowance = document.getElementById('allowance-input');

            if (studyName) studyName.value = '';
            if (stationInput) stationInput.value = '';
            const opEl = document.getElementById('study-observed-operator');
            const partEl = document.getElementById('study-part-number');
            const targetEl = document.getElementById('study-target-output');
            if (opEl) opEl.value = '';
            if (partEl) partEl.value = '';
            if (targetEl) targetEl.value = '';
            if (timer) timer.textContent = '00:00.00';
            if (total) total.textContent = '00:00.00';
            if (lapCount) lapCount.textContent = '0';
            if (avg) avg.textContent = '—';
            if (finalize) finalize.classList.add('hidden');

            const cycleSection = document.getElementById('cycle-observations-section');
            if (cycleSection) cycleSection.classList.add('hidden');

            if (allowance) allowance.value = 12;

            const shiftSel = document.getElementById('study-shift');
            const shiftCustom = document.getElementById('study-shift-custom');
            const shiftWrap = document.getElementById('study-shift-custom-wrap');
            if (shiftSel) shiftSel.value = 'Day';
            if (shiftCustom) shiftCustom.value = '';
            if (shiftWrap) shiftWrap.classList.add('hidden');

            // Reset buttons
            const spBtn = document.getElementById('start-pause-btn');
            const spText = document.getElementById('start-pause-text');
            if (spBtn) {
                spBtn.classList.remove('bg-red-600', 'hover:bg-red-500');
                spBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
            }
            if (spText) spText.textContent = 'START';

            // Clear any role warning
            const banner = document.getElementById('role-warning-banner');
            if (banner) {
                banner.className = 'hidden mb-4 px-4 py-2.5 rounded-2xl text-sm border';
                banner.innerHTML = '';
            }

            updateStats();
            updateFinalizeSection();
            renderLaps();
            renderWorkInstructions();
            renderPeriodicWork();
        }

        // ==================== 13. INITIALIZATION (ENHANCED) ====================
        function init() {
            loadFromStorage();
            populateAssignedCellSelect();
            refreshAreaSelect();   // ensures capture area-select is populated

            const field = document.getElementById('assigned-cell-field');
            if (field) field.style.display = 'none';

            const roleSelect = document.getElementById('login-role');
            if (roleSelect) {
                roleSelect.value = 'TMO';
                toggleAssignedCellField();
            }

            bindHeaderOverflowMenu();

            if (currentUser) {
                updateUserInfo();
                goToRoleHome();
            } else {
                document.getElementById('view-login').classList.remove('hidden');
            }

            const dateInput = document.getElementById('study-date');
            if (dateInput && !dateInput.value) {
                dateInput.value = new Date().toISOString().split('T')[0];
            }

            // Keyboard shortcuts (Space = start/pause, L = lap when running)
            document.addEventListener('keydown', e => {
                if (e.target.tagName === 'INPUT' || e.target.isContentEditable) return;
                const captureVisible = !document.getElementById('view-capture').classList.contains('hidden');
                if (!captureVisible) return;

                if (e.code === 'Space') {
                    e.preventDefault();
                    toggleStartPause();
                }
                if (e.key.toLowerCase() === 'l' && isRunning) {
                    e.preventDefault();
                    handleLapButton();
                }
                if (e.key.toLowerCase() === 'e' && isRunning && workflowMode === 'cycles' && laps.length > 0) {
                    e.preventDefault();
                    handleElementLapInCycles();
                }
            });

            // Default instructions
            setTimeout(() => {
                const instr = document.getElementById('mode-instructions');
                if (instr && instr.innerHTML.trim() === '') {
                    instr.innerHTML = `<strong>Define Elements:</strong> Time each task element once. Use ELEMENT LAP to split.`;
                }
            }, 100);

            // Populate takt UI (including Available Work Time) from default input values on load
            calculateTAKT();
            initTaktCalculatorCollapse();
            initWorkInstructionsCollapse();
        }

        window.onload = init;

        // ============================================================
        //  RESTORED + IMPLEMENTED FUNCTIONS (v2.5 complete build)
        //  Organized in clear sections for easier future edits.
        // ============================================================

        // ---------- Core navigation & mode ----------
        function switchView(view) {
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            const target = document.getElementById('view-' + view);
            if (target) target.classList.remove('hidden');

            if (view === 'studies') {
                renderStudiesList();
            }
            if (view === 'capture') {
                refreshAreaSelect();
                initTaktCalculatorCollapse();
                initWorkInstructionsCollapse();
                renderWorkInstructions();
            }
        }

        const CYCLES_COMBO_TIP_KEY = 'stdwork_cycles_combo_tip_dismissed_v20';

        function isCyclesComboTipDismissed() {
            return localStorage.getItem(CYCLES_COMBO_TIP_KEY) === '1';
        }

        function dismissCyclesComboTip() {
            localStorage.setItem(CYCLES_COMBO_TIP_KEY, '1');
            updateCyclesComboTip();
        }

        function updateCyclesComboTip() {
            const tip = document.getElementById('cycles-combo-tip');
            const text = document.getElementById('cycles-combo-tip-text');
            if (!tip) return;

            const show = workflowMode === 'cycles' && !isCyclesComboTipDismissed();
            tip.classList.toggle('hidden', !show);

            if (show && text) {
                if (laps.length > 0) {
                    text.innerHTML = `<strong>Quick tip:</strong> Tap <strong>ELEMENT LAP</strong> each time the operator changes tasks — it records a split to the next element while the timer keeps running. Tap <strong>RECORD CYCLE</strong> at the end of the full cycle to save total time and reset. Mix both freely.`;
                } else {
                    text.innerHTML = `<strong>Quick tip:</strong> Define your element list in <strong>Define Elements</strong> first. Then use <strong>ELEMENT LAP</strong> for isolated element times and <strong>RECORD CYCLE</strong> for full cycle totals.`;
                }
            }
        }

        function setWorkflowMode(mode) {
            workflowMode = mode;

            const elBtn = document.getElementById('mode-elements');
            const cyBtn = document.getElementById('mode-cycles');
            const lapText = document.getElementById('lap-btn-text');
            const lapBtn = document.getElementById('lap-btn');
            const instr = document.getElementById('mode-instructions');

            const lapEmeraldClasses = ['bg-emerald-700', 'hover:bg-emerald-600', 'bg-emerald-600', 'hover:bg-emerald-500', 'text-white'];
            const lapAmberClasses = ['bg-amber-500', 'hover:bg-amber-400', 'text-zinc-950'];

            if (mode === 'elements') {
                if (elBtn) { elBtn.classList.add('bg-amber-500', 'text-zinc-950'); elBtn.classList.remove('bg-emerald-700', 'text-white'); }
                if (cyBtn) { cyBtn.classList.add('bg-emerald-700', 'text-white'); cyBtn.classList.remove('bg-amber-500', 'text-zinc-950'); }
                if (lapBtn) {
                    lapBtn.classList.remove(...lapEmeraldClasses);
                    lapAmberClasses.forEach(c => lapBtn.classList.add(c));
                    lapBtn.title = 'Split and define the next work element';
                    lapBtn.setAttribute('aria-label', 'Element Lap — split next element');
                }
                if (lapText) lapText.textContent = 'ELEMENT LAP';
                if (instr) {
                    instr.innerHTML = `<strong>Define Elements:</strong> Time each task element once. Use ELEMENT LAP to split. Add observations via the clock icon for avg + std dev.`;
                    instr.className = `mb-4 px-4 py-3 rounded-2xl text-sm border bg-zinc-900 border-zinc-700 text-zinc-300`;
                }
            } else {
                if (cyBtn) { cyBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500', 'text-white'); cyBtn.classList.remove('bg-emerald-700', 'text-white'); }
                if (elBtn) { elBtn.classList.remove('bg-amber-500', 'text-zinc-950'); elBtn.classList.add('bg-emerald-700', 'text-white'); }
                if (lapBtn) {
                    lapBtn.classList.remove(...lapAmberClasses);
                    lapBtn.classList.add('bg-emerald-700', 'hover:bg-emerald-600', 'text-white');
                    lapBtn.title = 'Record full cycle time and reset timer';
                    lapBtn.setAttribute('aria-label', 'Record Cycle — save full cycle time');
                }
                if (lapText) lapText.textContent = 'RECORD CYCLE';
                if (instr) {
                    const elementTotal = getElementCycleTotal();
                    const elementLapHint = laps.length > 0
                        ? ` Use <strong>ELEMENT LAP</strong> to isolate elements during a cycle; <strong>RECORD CYCLE</strong> saves the full cycle time.`
                        : '';
                    if (cycleTimes.length === 0 && (elementTotal > 0 || elapsedTime > 0)) {
                        const pending = elapsedTime > 0 ? elapsedTime : elementTotal;
                        instr.innerHTML = `<strong>Time Cycles:</strong> Press <strong>RECORD CYCLE</strong> to save your element breakdown (${formatTime(pending)}) as Cycle #1, then record additional full cycles.${elementLapHint}`;
                    } else {
                        instr.innerHTML = `<strong>Time Cycles:</strong> Run full cycles. Press RECORD CYCLE at end of each full cycle. Timer auto-resets.${elementLapHint}`;
                    }
                    instr.className = `mb-4 px-4 py-3 rounded-2xl text-sm border bg-emerald-950/40 border-emerald-800 text-emerald-300`;
                }
                resetCycleElementLapPointer();
            }
            renderLaps();
            updateCopyTemplateButtonVisibility();
            updateCyclesComboTip();
        }

        // ---------- Entry points ----------
        function startNewStudyAsAdmin() {
            resetCaptureState();
            switchView('capture');
            setWorkflowMode('elements');
            populateCaptureAreas();
            renderLaps();
            updateCopyTemplateButtonVisibility();
        }

        function startNewStudyAsTMO() {
            if (!currentUser || currentUser.role !== 'TMO') return;
            resetCaptureState();
            const sel = document.getElementById('area-select');
            if (sel && currentUser.assignedCell) sel.value = currentUser.assignedCell;
            switchView('capture');
            setWorkflowMode('elements');
            renderLaps();
            updateCopyTemplateButtonVisibility();
        }

        function openManageModal() {
            if (!currentUser || currentUser.role !== 'ADMIN') return;
            const modal = document.getElementById('manage-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            switchManageTab('areas');
            renderManageAreas();
            renderManageUsers();
        }

        function closeManageModal() {
            manageModalBackdropDown = false;
            const modal = document.getElementById('manage-modal');
            if (modal) {
                modal.classList.remove('flex');
                modal.classList.add('hidden');
            }
            refreshAreaSelect();
            populateAssignedCellSelect();
            saveToStorage();
        }

        function onManageModalBackdropMouseDown(e) {
            manageModalBackdropDown = (e.target === e.currentTarget);
        }

        function onManageModalBackdropClick(e) {
            if (e.target === e.currentTarget && manageModalBackdropDown) {
                closeManageModal();
            }
            manageModalBackdropDown = false;
        }

        function switchManageTab(tab) {
            currentManageTab = tab;
            const areasTab = document.getElementById('manage-areas-tab');
            const usersTab = document.getElementById('manage-users-tab');
            const areasBtn = document.getElementById('manage-tab-areas');
            const usersBtn = document.getElementById('manage-tab-users');

            if (tab === 'areas') {
                if (areasTab) areasTab.classList.remove('hidden');
                if (usersTab) usersTab.classList.add('hidden');
                if (areasBtn) { areasBtn.classList.add('border-b-2', 'border-emerald-500', 'text-emerald-400'); areasBtn.classList.remove('text-zinc-400'); }
                if (usersBtn) usersBtn.classList.remove('border-b-2', 'border-emerald-500', 'text-emerald-400');
            } else {
                if (areasTab) areasTab.classList.add('hidden');
                if (usersTab) usersTab.classList.remove('hidden');
                if (usersBtn) { usersBtn.classList.add('border-b-2', 'border-emerald-500', 'text-emerald-400'); usersBtn.classList.remove('text-zinc-400'); }
                if (areasBtn) areasBtn.classList.remove('border-b-2', 'border-emerald-500', 'text-emerald-400');
                const cellSel = document.getElementById('new-tmo-cell');
                if (cellSel) {
                    cellSel.innerHTML = '';
                    areas.forEach(a => {
                        const o = document.createElement('option'); o.value = a; o.textContent = a; cellSel.appendChild(o);
                    });
                }
            }
        }

        function renderManageAreas() {
            const container = document.getElementById('manage-areas-list');
            if (!container) return;
            container.innerHTML = '';
            areas.forEach((area, idx) => {
                const studyCount = studies.filter(s => s.area === area).length;
                const div = document.createElement('div');
                div.className = 'flex items-center justify-between bg-zinc-950 border border-zinc-700 rounded-2xl px-4 py-3';
                div.innerHTML = `
                    <div>
                        <span class="font-mono font-semibold text-lg">${area}</span>
                        <span class="text-xs text-zinc-500 ml-2">${studyCount} ${studyCount === 1 ? 'study' : 'studies'}</span>
                    </div>
                `;
                container.appendChild(div);
            });
        }

        function addNewArea() {
            const input = document.getElementById('new-area-input');
            if (!input) return;
            const name = input.value.trim().toUpperCase();
            if (!name) return;
            if (areas.includes(name)) { alert('Area already exists'); return; }

            areas.push(name);

            const expectedTMO = 'TMO' + name.replace(/\D/g, '').padStart(2, '0');
            if (!users.find(u => u.assignedCell === name)) {
                users.push({ id: Date.now(), name: expectedTMO, role: 'TMO', assignedCell: name });
            }

            saveToStorage();
            input.value = '';
            renderManageAreas();
            renderManageUsers();
            refreshAreaSelect();
            populateAssignedCellSelect();
        }

        function renderManageUsers() {
            const container = document.getElementById('manage-users-list');
            if (!container) return;
            container.innerHTML = '';

            const tmoUsers = users.filter(u => u.role === 'TMO');
            if (tmoUsers.length === 0) {
                container.innerHTML = '<div class="text-zinc-500 text-sm py-4">No TMO assignments yet.</div>';
                return;
            }

            const table = document.createElement('table');
            table.className = 'w-full text-sm';
            table.innerHTML = `
                <thead class="text-xs text-zinc-400">
                    <tr class="border-b border-zinc-700">
                        <th class="text-left py-2 px-3">TMO Name</th>
                        <th class="text-left py-2 px-3">Assigned Cell</th>
                        <th class="text-right py-2 px-3 w-20">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-zinc-800"></tbody>
            `;
            const tbody = table.querySelector('tbody');

            tmoUsers.forEach((user) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="py-2.5 px-3 font-mono">${user.name}</td>
                    <td class="py-2.5 px-3">
                        <select onchange="changeUserCell(${user.id}, this.value)" class="bg-zinc-800 border border-zinc-700 text-xs rounded-xl px-2 py-1">
                            ${areas.map(a => `<option value="${a}" ${a === user.assignedCell ? 'selected' : ''}>${a}</option>`).join('')}
                        </select>
                    </td>
                    <td class="py-2.5 px-3 text-right">
                        <button onclick="deleteUser(${user.id}); event.stopImmediatePropagation()" class="text-red-400 hover:text-red-500 text-xs px-2">Remove</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            container.appendChild(table);
        }

        function changeUserCell(userId, newCell) {
            const user = users.find(u => u.id === userId);
            if (user) {
                user.assignedCell = newCell;
                saveToStorage();
                renderManageUsers();
            }
        }

        function addNewTMO(e) {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const nameInput = document.getElementById('new-tmo-name');
            const cellSel = document.getElementById('new-tmo-cell');
            if (!nameInput || !cellSel) return;
            const name = nameInput.value.trim().toUpperCase();
            const cell = cellSel.value;
            if (!name || !cell) return;
            if (users.find(u => u.name === name && u.assignedCell === cell)) {
                alert('This TMO is already assigned to that cell');
                return;
            }
            users.push({ id: Date.now(), name, role: 'TMO', assignedCell: cell });
            saveToStorage();
            renderManageUsers();
        }

        function deleteUser(userId) {
            if (!confirm('Remove this TMO assignment?')) return;
            users = users.filter(u => u.id !== userId);
            saveToStorage();
            renderManageUsers();
        }

        function showGlobalSettings() {
            if (confirm('Hard reset ALL local data (studies, users)? This cannot be undone.')) {
                localStorage.clear();
                location.reload();
            }
        }

        // ---------- Takt / TACT ----------
        // UI-only helper: mirrors the existing (shiftHrs * 3600) - (breaksMin * 60) math for display.
        // Does not alter takt calculation — keeps Available Work Time visible for first-time users.
        function updateTaktAvailableWorkTimeDisplay(shiftHrs, breaksMin, availableSec) {
            const availMinEl = document.getElementById('takt-available-min');
            const availFormulaEl = document.getElementById('takt-available-formula');
            if (!availMinEl || !availFormulaEl) return;

            if (!shiftHrs || shiftHrs <= 0) {
                availMinEl.textContent = '—';
                availFormulaEl.textContent = '= (shift hours × 60) – breaks/NVA';
                return;
            }

            const availableMin = Math.round(availableSec / 60);
            availMinEl.textContent = availableMin.toLocaleString();
            availFormulaEl.textContent = `= (${shiftHrs} × 60) – ${breaksMin}`;
        }

        function calculateTAKT() {
            const demandEl = document.getElementById('takt-demand');
            const shiftEl = document.getElementById('takt-shift-hours');
            const breaksEl = document.getElementById('takt-breaks-min');
            const taktDisplay = document.getElementById('takt-time-display');
            const wactDisplay = document.getElementById('wact-display');
            const headEl = document.getElementById('takt-headroom');
            const statusEl = document.getElementById('takt-status-text');

            if (!demandEl || !shiftEl || !breaksEl || !taktDisplay) return;

            const demand = parseFloat(demandEl.value) || 0;
            const shiftHrs = parseFloat(shiftEl.value) || 0;
            const breaksMin = parseFloat(breaksEl.value) || 0;

            if (demand <= 0 || shiftHrs <= 0) {
                taktDisplay.textContent = '—';
                if (wactDisplay) wactDisplay.textContent = '—';
                if (headEl) headEl.textContent = '—';
                if (statusEl) statusEl.textContent = '';
                updateTaktAvailableWorkTimeDisplay(shiftHrs, breaksMin, 0);
                return;
            }

            const availableSec = (shiftHrs * 3600) - (breaksMin * 60);
            updateTaktAvailableWorkTimeDisplay(shiftHrs, breaksMin, availableSec);

            if (availableSec <= 0) {
                taktDisplay.textContent = '—';
                return;
            }

            const takt = computeTaktSeconds(demand, shiftHrs, breaksMin);
            taktDisplay.textContent = takt ? takt.toLocaleString() : '—';

            const wact = getCurrentWACT();
            if (wactDisplay) {
                wactDisplay.textContent = wact > 0 ? wact.toLocaleString() : '—';
            }

            if (headEl && statusEl) {
                if (wact > 0 && takt > 0) {
                    const ratio = wact / takt;
                    const headroomPct = Math.round((1 - ratio) * 100);
                    if (ratio <= 0.85) {
                        headEl.textContent = `+${headroomPct}%`; headEl.className = 'font-mono text-3xl font-semibold mt-1 text-emerald-400';
                        statusEl.textContent = 'This station is faster than Takt — buffer at this station'; statusEl.className = 'text-xs mt-0.5 font-medium text-emerald-400';
                    } else if (ratio <= 0.95) {
                        headEl.textContent = `+${headroomPct}%`; headEl.className = 'font-mono text-3xl font-semibold mt-1 text-amber-400';
                        statusEl.textContent = 'Small buffer at this station — watch cycle times'; statusEl.className = 'text-xs mt-0.5 font-medium text-amber-400';
                    } else if (ratio <= 1.0) {
                        headEl.textContent = `+${headroomPct}%`; headEl.className = 'font-mono text-3xl font-semibold mt-1 text-orange-400';
                        statusEl.textContent = 'This station barely meets Takt — review elements'; statusEl.className = 'text-xs mt-0.5 font-medium text-orange-400';
                    } else {
                        const over = Math.round((ratio - 1) * 100);
                        headEl.textContent = `-${over}%`; headEl.className = 'font-mono text-3xl font-semibold mt-1 text-red-400';
                        statusEl.textContent = 'This station is behind Takt — review elements'; statusEl.className = 'text-xs mt-0.5 font-medium text-red-400';
                    }
                } else {
                    headEl.textContent = '—';
                    headEl.className = 'font-mono text-3xl font-semibold mt-1 text-zinc-500';
                    statusEl.textContent = 'Complete this station study, then compare WACT to Takt';
                    statusEl.className = 'text-xs mt-0.5 font-medium text-zinc-500';
                }
            }
            updateOEEPerformanceCard();
        }

        function refreshTAKT() {
            const section = document.getElementById('takt-calculator-section');
            if (section) calculateTAKT();
        }

        function syncTaktCollapseIcon(collapsed) {
            const icon = document.getElementById('takt-collapse-icon');
            if (!icon) return;
            icon.classList.toggle('fa-chevron-down', !collapsed);
            icon.classList.toggle('fa-chevron-up', collapsed);
        }

        function initTaktCalculatorCollapse() {
            const collapsible = document.getElementById('takt-inputs-collapsible');
            if (!collapsible) return;
            let stored = localStorage.getItem('stdwork_takt_collapsed');
            if (stored === null) {
                stored = window.innerWidth < 640 ? '1' : '0';
            }
            const collapsed = stored === '1';
            collapsible.classList.toggle('hidden', collapsed);
            syncTaktCollapseIcon(collapsed);
        }

        function toggleTaktCalculatorInputs() {
            const collapsible = document.getElementById('takt-inputs-collapsible');
            if (!collapsible) return;
            const collapsed = collapsible.classList.toggle('hidden');
            localStorage.setItem('stdwork_takt_collapsed', collapsed ? '1' : '0');
            syncTaktCollapseIcon(collapsed);
        }

        // ---------- Line Balance & Reporting (ADMIN) ----------
        function openLineReportModal() {
            if (!currentUser || currentUser.role !== 'ADMIN') return;
            const modal = document.getElementById('line-report-modal');
            const areaSel = document.getElementById('line-report-area');
            if (!modal || !areaSel) return;
            areaSel.innerHTML = '';
            areas.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = a;
                areaSel.appendChild(opt);
            });
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            renderLineReportContent();
        }

        function closeLineReportModal() {
            const modal = document.getElementById('line-report-modal');
            if (modal) {
                modal.classList.remove('flex');
                modal.classList.add('hidden');
            }
        }

        function getLineReportStudies(area) {
            return studies.filter(s => s.area === area);
        }

        function renderLineReportContent() {
            const areaSel = document.getElementById('line-report-area');
            const summaryEl = document.getElementById('line-report-summary');
            const chartEl = document.getElementById('line-report-chart');
            const tableEl = document.getElementById('line-report-table');
            if (!areaSel || !chartEl || !tableEl) return;

            const area = areaSel.value || areas[0];
            const areaStudies = getLineReportStudies(area);

            chartEl.innerHTML = '';
            if (areaStudies.length === 0) {
                if (summaryEl) {
                    summaryEl.textContent = `No studies found for ${area}. Create and save station studies in this area first.`;
                }
                chartEl.innerHTML = '<div class="text-zinc-500 text-sm py-4 text-center">No data to chart.</div>';
                tableEl.innerHTML = '<div class="text-zinc-500 text-sm py-4 text-center px-4">No studies in this area.</div>';
                return;
            }

            const stationGroups = groupStudiesByStation(areaStudies);
            const stationKeys = Object.keys(stationGroups).sort((a, b) => {
                const maxA = Math.max(...stationGroups[a].map(s => getStudyMetrics(s).wactSec || 0));
                const maxB = Math.max(...stationGroups[b].map(s => getStudyMetrics(s).wactSec || 0));
                return maxB - maxA;
            });
            const agg = getLineReportAggregates(areaStudies);
            const rows = agg.rows;
            const { lineTactSec, balancePct, customerTaktSec, bottleneck } = agg;

            if (summaryEl) {
                if (rows.length === 0) {
                    summaryEl.textContent = `${areaStudies.length} ${areaStudies.length === 1 ? 'study' : 'studies'} in ${area} — save element observations to populate WACT.`;
                } else {
                    const pills = [
                        `<span class="line-metric-pill"><strong>Line TACT:</strong> ${lineTactSec}s</span>`,
                        `<span class="line-metric-pill"><strong>Stations:</strong> ${stationKeys.length}</span>`,
                        `<span class="line-metric-pill"><strong>Studies:</strong> ${areaStudies.length}</span>`,
                        balancePct !== null ? `<span class="line-metric-pill"><strong>Balance:</strong> ${balancePct}%</span>` : '',
                        customerTaktSec ? `<span class="line-metric-pill"><strong>Customer Takt:</strong> ${customerTaktSec}s</span>` : '',
                        bottleneck ? `<span class="line-metric-pill"><strong>Bottleneck:</strong> ${getStationLabel(bottleneck.study)} — ${bottleneck.study.studyName}</span>` : ''
                    ].filter(Boolean).join('');
                    summaryEl.innerHTML = `<div class="mb-1.5">${areaStudies.length} ${areaStudies.length === 1 ? 'study' : 'studies'} across ${stationKeys.length} station${stationKeys.length === 1 ? '' : 's'} in <strong>${area}</strong>. Line TACT = slowest WACT (bottleneck).</div><div>${pills}</div>`;
                }
            }

            if (rows.length === 0) {
                chartEl.innerHTML = '<div class="text-zinc-500 text-sm py-4 text-center">Studies exist but no WACT data yet.</div>';
            } else {
                const maxScale = Math.max(lineTactSec, customerTaktSec || 0) * 1.05 || 1;

                const legend = document.createElement('div');
                legend.className = 'line-chart-legend';
                legend.innerHTML = `
                    <span><span class="legend-swatch" style="background:var(--accent-color)"></span> Study WACT</span>
                    <span><span class="legend-swatch" style="background:var(--accent-color);filter:brightness(0.82)"></span> Line bottleneck</span>
                    ${customerTaktSec ? '<span><span class="legend-swatch" style="background:#ef4444"></span> Customer Takt</span>' : ''}
                `;
                chartEl.appendChild(legend);

                stationKeys.forEach(stationKey => {
                    const groupStudies = stationGroups[stationKey];
                    const groupRows = groupStudies
                        .map(study => ({ study, ...getStudyMetrics(study) }))
                        .filter(r => r.wactSec > 0)
                        .sort((a, b) => b.wactSec - a.wactSec);
                    if (groupRows.length === 0) return;

                    const stationMax = Math.max(...groupRows.map(r => r.wactSec));
                    const header = document.createElement('div');
                    header.className = 'line-station-header';
                    header.textContent = `${stationKey.toUpperCase()} — max WACT ${stationMax}s (${groupRows.length} ${groupRows.length === 1 ? 'study' : 'studies'})`;
                    chartEl.appendChild(header);

                    groupRows.forEach(row => {
                        const pct = Math.round((row.wactSec / maxScale) * 100);
                        const isBottleneck = row.wactSec === lineTactSec;
                        const taktMarkerPct = customerTaktSec ? Math.round((customerTaktSec / maxScale) * 100) : null;
                        const barRow = document.createElement('div');
                        barRow.className = 'line-bar-row';
                        barRow.innerHTML = `
                            <div class="line-bar-label" title="${row.study.studyName}">${row.study.studyName}</div>
                            <div class="line-bar-track">
                                <div class="line-bar-fill${isBottleneck ? ' bottleneck' : ''}" style="width:${pct}%"></div>
                                ${taktMarkerPct !== null ? `<div class="line-takt-marker" style="left:${taktMarkerPct}%" title="Customer Takt: ${customerTaktSec}s"></div>` : ''}
                            </div>
                            <div class="line-bar-value font-mono text-xs w-14 text-right">${row.wactSec}s</div>
                        `;
                        chartEl.appendChild(barRow);
                    });
                });
            }

            const table = document.createElement('table');
            table.className = 'w-full text-xs sm:text-sm';
            table.innerHTML = `
                <thead class="text-zinc-400 border-b border-zinc-800">
                    <tr>
                        <th class="text-left py-2 px-3">Study</th>
                        <th class="text-right py-2 px-3">Elements</th>
                        <th class="text-right py-2 px-3">WACT (s)</th>
                        <th class="text-right py-2 px-3">Takt (s)</th>
                        <th class="text-right py-2 px-3">Headroom</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-zinc-800"></tbody>
            `;
            const tbody = table.querySelector('tbody');
            stationKeys.forEach(stationKey => {
                const groupStudies = stationGroups[stationKey];
                const groupMax = Math.max(...groupStudies.map(s => getStudyMetrics(s).wactSec || 0));
                const headerTr = document.createElement('tr');
                headerTr.className = 'bg-zinc-900/80';
                headerTr.innerHTML = `
                    <td colspan="5" class="py-2 px-3 font-semibold text-emerald-400">
                        ${stationKey}
                        <span class="text-zinc-500 font-normal ml-2">${groupStudies.length} ${groupStudies.length === 1 ? 'study' : 'studies'}${groupMax > 0 ? ` · station max WACT ${groupMax}s` : ''}</span>
                    </td>
                `;
                tbody.appendChild(headerTr);

                groupStudies.forEach(study => {
                    const m = getStudyMetrics(study);
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td class="py-2 px-3 font-medium pl-5">${study.studyName}</td>
                        <td class="py-2 px-3 text-right font-mono">${study.laps?.length || 0}</td>
                        <td class="py-2 px-3 text-right font-mono">${m.wactSec > 0 ? m.wactSec : '—'}</td>
                        <td class="py-2 px-3 text-right font-mono">${m.taktSec ? m.taktSec : '—'}</td>
                        <td class="py-2 px-3 text-right font-mono">${m.headroomPct !== null ? (m.headroomPct >= 0 ? '+' : '') + m.headroomPct + '%' : '—'}</td>
                    `;
                    tbody.appendChild(tr);
                });
            });
            tableEl.innerHTML = '';
            tableEl.appendChild(table);
        }

        function getLineReportAggregates(areaStudies) {
            const rows = areaStudies.map(study => ({ study, ...getStudyMetrics(study) })).filter(r => r.wactSec > 0);
            const wactValues = rows.map(r => r.wactSec);
            const lineTactSec = wactValues.length ? Math.max(...wactValues) : 0;
            const minWactSec = wactValues.length ? Math.min(...wactValues) : 0;
            const balancePct = lineTactSec > 0 ? Math.round((minWactSec / lineTactSec) * 100) : null;
            const taktValues = rows.map(r => r.taktSec).filter(t => t > 0);
            const customerTaktSec = taktValues.length ? Math.round(taktValues.reduce((a, b) => a + b, 0) / taktValues.length) : null;
            const bottleneck = rows.length ? rows.reduce((a, b) => (a.wactSec >= b.wactSec ? a : b)) : null;
            return { rows, lineTactSec, minWactSec, balancePct, customerTaktSec, bottleneck };
        }

        function exportLineReportCSV() {
            const areaSel = document.getElementById('line-report-area');
            if (!areaSel) return;
            const area = areaSel.value;
            const areaStudies = getLineReportStudies(area);
            if (areaStudies.length === 0) {
                alert('No studies to export for this area.');
                return;
            }

            const agg = getLineReportAggregates(areaStudies);
            const exportedAt = new Date().toISOString();
            let csv = `StdWork Line Summary Report\n`;
            csv += `Exported,${exportedAt}\n`;
            csv += `Area / Line,${area}\n`;
            csv += `Station Studies,${areaStudies.length}\n`;
            csv += `Distinct Stations,${Object.keys(groupStudiesByStation(areaStudies)).length}\n`;
            csv += `Line TACT (sec),${agg.lineTactSec || ''}\n`;
            csv += `Line Balance (%),${agg.balancePct !== null ? agg.balancePct : ''}\n`;
            csv += `Customer Takt (sec),${agg.customerTaktSec || ''}\n`;
            csv += `Bottleneck Station,"${(agg.bottleneck ? getStationLabel(agg.bottleneck.study) + ' — ' + agg.bottleneck.study.studyName : '').replace(/"/g, '""')}"\n`;
            csv += `\n`;
            csv += 'Area,Station,Study Name,Elements,WACT (sec),Takt (sec),Headroom (%),Allowance (%),Date,Created By,Workflow\n';
            const stationGroups = groupStudiesByStation(areaStudies);
            Object.keys(stationGroups).sort().forEach(stationKey => {
                stationGroups[stationKey].forEach(study => {
                const m = getStudyMetrics(study);
                const name = `"${(study.studyName || '').replace(/"/g, '""')}"`;
                const station = `"${stationKey.replace(/"/g, '""')}"`;
                const row = [
                    area,
                    station,
                    name,
                    study.laps?.length || 0,
                    m.wactSec > 0 ? m.wactSec : '',
                    m.taktSec || '',
                    m.headroomPct !== null ? m.headroomPct : '',
                    study.allowancePct || 12,
                    study.date || '',
                    `"${(study.createdBy || '').replace(/"/g, '""')}"`,
                    study.workflowMode || 'elements'
                ];
                csv += row.join(',') + '\n';
                });
            });

            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `StdWork_LineSummary_${area}_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function openTACTModal() {
            const modal = document.getElementById('tact-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            calculateTACTOnly();
        }

        function closeTACTModal() {
            const modal = document.getElementById('tact-modal');
            if (modal) {
                modal.classList.remove('flex');
                modal.classList.add('hidden');
            }
        }

        function openORRateModal() {
            const modal = document.getElementById('or-rate-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            calculateORRate();
        }

        function closeORRateModal() {
            const modal = document.getElementById('or-rate-modal');
            if (modal) {
                modal.classList.remove('flex');
                modal.classList.add('hidden');
            }
        }

        function calculateORRate() {
            const targetEl = document.getElementById('or-target-rate');
            const unitEl = document.getElementById('or-rate-unit');
            const periodEl = document.getElementById('or-period-hours');
            const opsEl = document.getElementById('or-actual-operators');
            const outputEl = document.getElementById('or-actual-output');
            const resultEl = document.getElementById('or-rate-result');
            const interpretEl = document.getElementById('or-rate-interpretation');
            const expectedEl = document.getElementById('or-expected-output');
            const actualDisplayEl = document.getElementById('or-actual-output-display');
            const formulaEl = document.getElementById('or-rate-formula');
            const periodWrap = document.getElementById('or-period-wrap');

            if (!targetEl || !unitEl || !opsEl || !outputEl || !resultEl) return;

            const unit = unitEl.value === 'shift' ? 'shift' : 'hour';
            if (periodWrap) periodWrap.classList.toggle('hidden', unit === 'shift');

            const targetRate = parseFloat(targetEl.value) || 0;
            const periodHrs = parseFloat(periodEl?.value) || 0;
            const operators = parseFloat(opsEl.value) || 0;
            const actualOutput = parseFloat(outputEl.value) || 0;

            const clearResult = () => {
                resultEl.textContent = '—';
                if (interpretEl) interpretEl.textContent = '';
                if (expectedEl) expectedEl.textContent = '—';
                if (actualDisplayEl) actualDisplayEl.textContent = actualOutput > 0 ? actualOutput.toLocaleString() + ' units' : '—';
                if (formulaEl) formulaEl.textContent = '';
            };

            if (targetRate <= 0 || operators <= 0) {
                clearResult();
                return;
            }

            let expected;
            let formula;
            if (unit === 'hour') {
                if (periodHrs <= 0) {
                    clearResult();
                    return;
                }
                expected = targetRate * operators * periodHrs;
                formula = `Expected = ${targetRate} u/hr × ${operators} ops × ${periodHrs} hr = ${Math.round(expected).toLocaleString()} units`;
            } else {
                expected = targetRate * operators;
                formula = `Expected = ${targetRate} u/shift × ${operators} ops = ${Math.round(expected).toLocaleString()} units`;
            }

            const orPct = expected > 0 ? Math.round((actualOutput / expected) * 100) : 0;
            resultEl.textContent = orPct.toLocaleString() + '%';
            if (expectedEl) expectedEl.textContent = Math.round(expected).toLocaleString() + ' units';
            if (actualDisplayEl) actualDisplayEl.textContent = actualOutput.toLocaleString() + ' units';
            if (formulaEl) formulaEl.textContent = formula + ` → OR% = ${actualOutput.toLocaleString()} ÷ ${Math.round(expected).toLocaleString()} × 100`;

            if (interpretEl) {
                if (orPct >= 100) {
                    interpretEl.textContent = 'At or above staffed expectation — team met or beat the output target for this staffing level.';
                    resultEl.className = 'font-mono text-5xl font-semibold text-emerald-400 mt-1';
                } else if (orPct >= 85) {
                    interpretEl.textContent = 'Slightly below staffed expectation — small gap; check barriers before changing headcount.';
                    resultEl.className = 'font-mono text-5xl font-semibold text-amber-400 mt-1';
                } else {
                    interpretEl.textContent = 'Below staffed expectation — review staffing, training, or process barriers.';
                    resultEl.className = 'font-mono text-5xl font-semibold text-red-400 mt-1';
                }
            }
        }

        function calculateTACTOnly() {
            const demandEl = document.getElementById('tact-demand-input');
            const availEl = document.getElementById('tact-available-min');
            const resultEl = document.getElementById('tact-result');
            const comp = document.getElementById('tact-comparison');
            if (!demandEl || !availEl || !resultEl) return;

            const demand = parseFloat(demandEl.value) || 0;
            const availMin = parseFloat(availEl.value) || 0;

            if (demand <= 0 || availMin <= 0) {
                resultEl.textContent = '—';
                if (comp) comp.classList.add('hidden');
                return;
            }

            const tactSec = Math.round((availMin * 60) / demand);
            resultEl.textContent = tactSec.toLocaleString();

            const wact = getCurrentWACT();
            if (wact > 0 && comp) {
                comp.classList.remove('hidden');
                document.getElementById('tact-wact-value').textContent = wact + 's';
                const ratio = wact / tactSec;
                const vsEl = document.getElementById('tact-vs-wact');
                const statusEl = document.getElementById('tact-meets-demand');
                if (ratio <= 0.9) {
                    vsEl.textContent = `WACT is ${Math.round((1-ratio)*100)}% under TACT`;
                    vsEl.className = 'font-semibold text-lg text-emerald-400';
                    statusEl.textContent = '✓ Process meets demand with good buffer';
                    statusEl.className = 'mt-3 text-xs px-3 py-1.5 rounded-xl text-center font-medium bg-emerald-900 text-emerald-300';
                } else if (ratio <= 1.0) {
                    vsEl.textContent = `WACT is ${Math.round((ratio-1)*100)}% over TACT`;
                    vsEl.className = 'font-semibold text-lg text-amber-400';
                    statusEl.textContent = 'Tight — limited buffer';
                    statusEl.className = 'mt-3 text-xs px-3 py-1.5 rounded-xl text-center font-medium bg-amber-900 text-amber-300';
                } else {
                    vsEl.textContent = `WACT is ${Math.round((ratio-1)*100)}% over TACT`;
                    vsEl.className = 'font-semibold text-lg text-red-400';
                    statusEl.textContent = 'Cannot meet demand at current standard';
                    statusEl.className = 'mt-3 text-xs px-3 py-1.5 rounded-xl text-center font-medium bg-red-900 text-red-300';
                }
            } else if (comp) {
                comp.classList.add('hidden');
            }
        }

        function applyTACTToStudy() {
            // Simple: just close. User can reference the number. Could copy into notes later.
            closeTACTModal();
            const instr = document.getElementById('mode-instructions');
            if (instr) instr.innerHTML = 'TACT value noted. Use the live calculator section while timing.';
        }

        // ---------- Element observation modal ----------
        function resetModalTimerToZero() {
            if (modalInterval) { clearInterval(modalInterval); modalInterval = null; }
            modalRunning = false;
            modalElapsed = 0;
            const disp = document.getElementById('modal-timer-display');
            if (disp) disp.textContent = '00:00.00';
            const btnText = document.getElementById('modal-start-pause-text');
            if (btnText) btnText.textContent = 'START';
            const icon = document.getElementById('modal-play-icon');
            if (icon) { icon.classList.add('fa-play'); icon.classList.remove('fa-pause'); }
        }

        function openElementalModal(index) {
            if (isReadOnlyMode()) return;
            modalLapIndex = index;
            modalPeriodicIndex = null;
            const lap = laps[index];
            if (!lap) return;

            const nameEl = document.getElementById('modal-element-name');
            const subtitleEl = document.getElementById('modal-element-subtitle');
            if (nameEl) nameEl.textContent = lap.name || `Element ${lap.number}`;
            if (subtitleEl) subtitleEl.textContent = 'ELEMENTAL TIME STUDY';

            resetModalTimerToZero();
            renderModalObservations();

            const m = document.getElementById('elemental-modal');
            if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
        }

        function openPeriodicModal(index) {
            if (isReadOnlyMode()) return;
            modalPeriodicIndex = index;
            modalLapIndex = null;
            const item = periodicWorkItems[index];
            if (!item) return;

            const nameEl = document.getElementById('modal-element-name');
            const subtitleEl = document.getElementById('modal-element-subtitle');
            if (nameEl) nameEl.textContent = item.name || 'Periodic Task';
            if (subtitleEl) {
                subtitleEl.textContent = item.itemType === 'changeover'
                    ? 'CHANGE-OVER / TOOL CHANGE TIMING'
                    : 'PERIODIC / NON-REGULAR WORK';
            }

            resetModalTimerToZero();
            renderModalObservations();

            const m = document.getElementById('elemental-modal');
            if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
        }

        function closeElementalModal() {
            if (modalInterval) clearInterval(modalInterval);
            modalPeriodicIndex = null;
            modalLapIndex = null;
            const m = document.getElementById('elemental-modal');
            if (m) { m.classList.remove('flex'); m.classList.add('hidden'); }
            renderLaps();
            renderPeriodicWork();
            saveToStorage();
        }

        function toggleModalTimer() {
            const btnText = document.getElementById('modal-start-pause-text');
            const icon = document.getElementById('modal-play-icon');
            if (!btnText || !icon) return;

            if (!modalRunning) {
                modalStart = Date.now() - modalElapsed;
                modalInterval = setInterval(() => {
                    modalElapsed = Date.now() - modalStart;
                    const d = document.getElementById('modal-timer-display');
                    if (d) d.textContent = formatTime(modalElapsed);
                }, 10);
                modalRunning = true;
                btnText.textContent = 'PAUSE';
                icon.classList.remove('fa-play'); icon.classList.add('fa-pause');
            } else {
                clearInterval(modalInterval);
                modalRunning = false;
                btnText.textContent = 'RESUME';
                icon.classList.remove('fa-pause'); icon.classList.add('fa-play');
            }
        }

        function getModalObservationTarget() {
            if (modalPeriodicIndex != null) return periodicWorkItems[modalPeriodicIndex];
            if (modalLapIndex != null) return laps[modalLapIndex];
            return null;
        }

        function recordElementalObservation() {
            if (!modalRunning) {
                toggleModalTimer();
                return;
            }
            const target = getModalObservationTarget();
            if (!target) return;
            if (!target.observations) target.observations = [];
            target.observations.push(modalElapsed);
            renderModalObservations();
            saveToStorage();
            resetModalTimerToZero();
        }

        function renderModalObservations() {
            const target = getModalObservationTarget();
            if (!target) return;

            const stats = calculateStats(target.observations || []);
            const allowance = getAllowance();
            const standard = stats.count > 0 ? getStandardTime(stats.avg, allowance) : 0;

            const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

            setText('modal-obs-count', stats.count);
            setText('modal-avg', stats.count ? formatTime(stats.avg) : '—');
            setText('modal-stddev', stats.count ? formatTime(stats.std) : '—');
            setText('modal-minmax', stats.count ? `${formatTime(stats.min)} / ${formatTime(stats.max)}` : '— / —');

            const stdRow = document.getElementById('modal-standard-row');
            const stdTimeEl = document.getElementById('modal-standard-time');
            if (stdRow && stdTimeEl) {
                if (stats.count > 0) {
                    stdRow.classList.remove('hidden');
                    stdTimeEl.textContent = formatTime(standard) + ` (+${allowance}%)`;
                } else {
                    stdRow.classList.add('hidden');
                }
            }

            const list = document.getElementById('modal-obs-list');
            if (!list) return;
            list.innerHTML = '';

            if (!target.observations || target.observations.length === 0) {
                list.innerHTML = `<div class="px-3 py-4 text-xs text-zinc-500">No observations. Start the timer and tap RECORD.</div>`;
                return;
            }

            target.observations.forEach((obs, idx) => {
                const row = document.createElement('div');
                row.className = 'flex justify-between px-3 py-1 text-sm hover:bg-zinc-900 rounded items-center';
                row.innerHTML = `
                    <span>#${idx+1} — <span class="font-semibold">${formatTime(obs)}</span></span>
                    <button onclick="deleteModalObs(${idx}); event.stopImmediatePropagation()" class="text-red-400 hover:text-red-500 px-2">×</button>
                `;
                list.appendChild(row);
            });
        }

        function deleteModalObs(idx) {
            const target = getModalObservationTarget();
            if (!target || !target.observations) return;
            target.observations.splice(idx, 1);
            renderModalObservations();
            saveToStorage();
        }

        // ---------- Copy template ----------
        function openCopyTemplateModal() {
            if (isReadOnlyMode() || workflowMode !== 'elements') return;
            const modal = document.getElementById('copy-template-modal');
            const list = document.getElementById('template-studies-list');
            if (!modal || !list) return;
            list.innerHTML = '';

            const currentArea = document.getElementById('area-select')?.value;
            let candidates = studies.filter(s => s.workflowMode === 'elements' && s.laps && s.laps.length > 0);

            if (currentArea) {
                const same = candidates.filter(s => s.area === currentArea);
                const other = candidates.filter(s => s.area !== currentArea);
                candidates = [...same, ...other];
            }

            if (candidates.length === 0) {
                list.innerHTML = `<div class="text-zinc-500 text-sm py-4">No previous element studies to copy from.</div>`;
            } else {
                candidates.slice(0, 12).forEach(study => {
                    const div = document.createElement('div');
                    div.className = 'bg-zinc-950 border border-zinc-700 hover:border-amber-500 rounded-2xl px-4 py-3 cursor-pointer flex justify-between items-center';
                    div.innerHTML = `
                        <div>
                            <div class="font-semibold">${study.studyName}</div>
                            <div class="text-xs text-zinc-400">${study.area} • ${study.laps.length} elements • ${study.date || ''}</div>
                        </div>
                        <div class="text-amber-400"><i class="fa-solid fa-arrow-right"></i></div>
                    `;
                    div.onclick = () => { copyElementsFromStudy(study.id); closeCopyTemplateModal(); };
                    list.appendChild(div);
                });
            }
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        function closeCopyTemplateModal() {
            const modal = document.getElementById('copy-template-modal');
            if (modal) { modal.classList.remove('flex'); modal.classList.add('hidden'); }
        }

        function copyElementsFromStudy(studyId) {
            const source = studies.find(s => s.id === studyId);
            if (!source || !source.laps || source.laps.length === 0) return;

            if (!confirm(`Replace current elements with ${source.laps.length} names from "${source.studyName}"?\n(Times & observations will NOT be copied.)`)) return;

            laps = source.laps.map((lap, i) => ({
                number: i + 1,
                name: lap.name || `Element ${i + 1}`,
                split: 0,
                observations: [],
                workType: lap.workType || 'regular'
            }));
            cycleTimes = [];
            elapsedTime = 0;
            isRunning = false;
            if (timerInterval) clearInterval(timerInterval);

            const t = document.getElementById('timer-display');
            const tot = document.getElementById('total-time');
            if (t) t.textContent = '00:00.00';
            if (tot) tot.textContent = '00:00.00';

            const spBtn = document.getElementById('start-pause-btn');
            const spText = document.getElementById('start-pause-text');
            if (spBtn) { spBtn.classList.remove('bg-red-600'); spBtn.classList.add('bg-emerald-600'); }
            if (spText) spText.textContent = 'START';

            setWorkflowMode('elements');
            renderLaps();
            saveToStorage();
        }

        // ---------- Load / Save study ----------
        function loadStudyIntoCapture(id, canEditParam) {
            const study = studies.find(s => s.id === id);
            if (!study) return;

            let canEdit = canEditParam;
            if (currentUser?.role === 'TMO' && study.ownerCell && study.ownerCell !== currentUser.assignedCell) {
                canEdit = false;
            }

            resetCaptureState();

            const nameEl = document.getElementById('study-name');
            const dateEl = document.getElementById('study-date');
            const areaEl = document.getElementById('area-select');
            const allowEl = document.getElementById('allowance-input');

            captureStudyId = study.id;

            if (nameEl) nameEl.value = study.studyName || '';
            if (dateEl) dateEl.value = study.date || new Date().toISOString().split('T')[0];
            if (areaEl) areaEl.value = study.area || '';

            const stationEl = document.getElementById('station-input');
            if (stationEl) stationEl.value = study.station || '';

            const opEl = document.getElementById('study-observed-operator');
            const partEl = document.getElementById('study-part-number');
            const targetEl = document.getElementById('study-target-output');
            if (opEl) opEl.value = study.observedOperator || '';
            if (partEl) partEl.value = study.partNumber || '';
            if (targetEl) targetEl.value = study.targetOutput != null ? study.targetOutput : '';

            if (allowEl) allowEl.value = study.allowancePct || 12;

            const shiftEl = document.getElementById('study-shift');
            const shiftCustomEl = document.getElementById('study-shift-custom');
            const shiftWrap = document.getElementById('study-shift-custom-wrap');
            if (shiftEl) shiftEl.value = study.shift || 'Day';
            if (shiftCustomEl) shiftCustomEl.value = study.shiftCustom || '';
            if (shiftWrap) shiftWrap.classList.toggle('hidden', (study.shift || 'Day') !== 'Custom');

            workInstructions = study.workInstructions
                ? JSON.parse(JSON.stringify(study.workInstructions))
                : [];

            laps = study.laps ? JSON.parse(JSON.stringify(study.laps)) : [];
            cycleTimes = study.cycleTimes ? [...study.cycleTimes] : [];
            periodicWorkItems = study.periodicWorkItems
                ? JSON.parse(JSON.stringify(study.periodicWorkItems))
                : [];

            const useCycles = (study.workflowMode === 'cycles') || (cycleTimes.length > 0 && laps.length === 0);
            setWorkflowMode(useCycles ? 'cycles' : 'elements');

            elapsedTime = study.totalTime || 0;
            const timerEl = document.getElementById('timer-display');
            const totalEl = document.getElementById('total-time');
            if (timerEl) timerEl.textContent = formatTime(elapsedTime);
            if (totalEl) totalEl.textContent = formatTime(elapsedTime);

            renderLaps();
            renderCycleObservations();
            renderWorkInstructions();
            renderPeriodicWork();

            switchView('capture');

            const banner = document.getElementById('role-warning-banner');
            if (banner) {
                if (!canEdit && currentUser && currentUser.role !== 'ADMIN') {
                    banner.classList.remove('hidden');
                    banner.classList.add('bg-blue-950/60', 'border-blue-800', 'text-blue-300');
                    banner.innerHTML = `<i class="fa-solid fa-lock mr-2"></i> <strong>READ-ONLY</strong> — Editing disabled (different cell).`;
                } else {
                    banner.classList.add('hidden');
                    banner.classList.remove('bg-blue-950/60', 'border-blue-800', 'text-blue-300');
                }
            }

            refreshTAKT();
            calculateTAKT();
            updateOEEPerformanceCard();
        }

        // ---------- Exports ----------
        function exportKaizenReport() {
            if (laps.length === 0) { alert('No element data to export.'); return; }
            const area = document.getElementById('area-select')?.value || 'Unknown';
            const studyName = document.getElementById('study-name')?.value.trim() || 'Untitled';
            const allowance = getAllowance();

            let csv = 'Element#,Element Name,Work Type,Observed Low (ms),Observed Avg (ms),Observed High (ms),Standard Time (ms),Std Dev (ms),FLUCT %,Obs Count,Notes\n';
            laps.forEach((lap, idx) => {
                const st = calculateStats(lap.observations || []);
                const stdTime = st.count > 0 ? getStandardTime(st.avg, allowance) : 0;
                const varPct = st.count > 1 && st.avg > 0 ? computeFluctPct(st.min, st.max, st.avg) : 0;
                csv += [
                    lap.number || (idx + 1),
                    `"${(lap.name || 'Element ' + (idx + 1)).replace(/"/g, '""')}"`,
                    lap.workType || 'regular',
                    st.min || 0,
                    st.avg || 0,
                    st.max || 0,
                    stdTime,
                    st.std || 0,
                    varPct + '%',
                    st.count,
                    st.count > 0 ? 'Review high FLUCT % elements' : 'No data yet'
                ].join(',') + '\n';
            });

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Kaizen_${area}_${studyName.replace(/[^a-z0-9]/gi,'_')}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

        function exportStudyJSON(studyId) {
            const study = studies.find(s => s.id === studyId);
            if (!study) return;
            const dataStr = JSON.stringify(study, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            const link = document.createElement('a');
            link.setAttribute('href', dataUri);
            link.setAttribute('download', `StdWork_${study.area}_${(study.studyName||'study').replace(/[^a-z0-9]/gi,'_')}.json`);
            link.click();
        }

        function exportStudyCSV(studyId) {
            const study = studies.find(s => s.id === studyId);
            if (!study) return;
            const allowance = study.allowancePct || 12;
            const stationCol = `"${(study.station || '').replace(/"/g, '""')}"`;
            const wiCol = study.workInstructions?.length
                ? `"${JSON.stringify(study.workInstructions).replace(/"/g, '""')}"`
                : 'N/A';
            let csv = 'StudyID,StudyName,Area,Station,Shift,WorkInstructions,Date,CreatedBy,TotalTime_ms,AllowancePct,Mode,Item#,ItemName,WorkType,Time_ms,Time_formatted,ObsCount,Min_ms,Max_ms,Avg_ms,Std_ms,Standard_ms,Standard_formatted\n';

            const sid = study.id;
            const name = `"${(study.studyName||'').replace(/"/g,'""')}"`;
            const shiftCol = `"${getShiftLabel(study).replace(/"/g, '""')}"`;

            if (study.workflowMode === 'cycles' && study.cycleTimes && study.cycleTimes.length) {
                const avg = study.cycleTimes.reduce((a,b)=>a+b,0) / study.cycleTimes.length;
                const stdCycle = Math.round(avg * (1 + allowance / 100));
                study.cycleTimes.forEach((t, i) => {
                    csv += [sid, name, study.area, stationCol, shiftCol, wiCol, study.date||'', study.createdBy, study.totalTime, allowance, 'CYCLES', i+1, `Cycle ${i+1}`, 'regular', t, formatTime(t), 1, t, t, t, 0, stdCycle, formatTime(stdCycle)].join(',') + '\n';
                });
                if (study.laps) {
                    study.laps.forEach((lap, i) => {
                        const st = calculateStats(lap.observations || []);
                        if (!st.count) return;
                        const stdT = getStandardTime(st.avg, allowance);
                        csv += [sid, name, study.area, stationCol, shiftCol, wiCol, study.date||'', study.createdBy, study.totalTime, allowance, 'CYCLES_ELEMENT',
                            lap.number || (i+1), `"${(lap.name||'').replace(/"/g,'""')}"`, lap.workType || 'regular',
                            lap.split || 0, formatTime(lap.split||0),
                            st.count, st.min||0, st.max||0, st.avg||0, st.std||0, stdT, formatTime(stdT)].join(',') + '\n';
                    });
                }
            } else if (study.laps) {
                study.laps.forEach((lap, i) => {
                    const st = calculateStats(lap.observations || []);
                    const stdT = st.count ? getStandardTime(st.avg, allowance) : 0;
                    csv += [sid, name, study.area, stationCol, shiftCol, wiCol, study.date||'', study.createdBy, study.totalTime, allowance, 'ELEMENTS',
                        lap.number || (i+1), `"${(lap.name||'').replace(/"/g,'""')}"`, lap.workType || 'regular',
                        lap.split || 0, formatTime(lap.split||0),
                        st.count, st.min||0, st.max||0, st.avg||0, st.std||0, stdT, formatTime(stdT)].join(',') + '\n';
                });
            }

            const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `StdWork_${study.area}_study.csv`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }

        function exportAllStudiesJSON() {
            const data = { exportedAt: new Date().toISOString(), studies, deletedStudies, areas, users };
            const uri = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
            const link = document.createElement('a');
            link.href = uri;
            link.download = `StdWork_All_Export_${new Date().toISOString().slice(0,10)}.json`;
            link.click();
        }

        function exportVisibleStudiesJSON() {
            const visible = getFilteredStudiesForList();
            if (visible.length === 0) {
                alert('No studies to export for the current filters.');
                return;
            }
            const areaFilter = document.getElementById('studies-area-filter');
            const areaVal = areaFilter?.value || '';
            const data = {
                exportedAt: new Date().toISOString(),
                filter: {
                    area: areaVal || 'all',
                    search: document.getElementById('studies-search')?.value?.trim() || ''
                },
                studyCount: visible.length,
                studies: visible
            };
            const uri = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
            const link = document.createElement('a');
            const suffix = areaVal ? areaVal.replace(/[^a-z0-9]/gi, '_') : 'filtered';
            link.href = uri;
            link.download = `StdWork_Studies_${suffix}_${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
        }

        // ---------- Delete element (in capture table) ----------
        function deleteElement(index) {
            if (isReadOnlyMode() || workflowMode === 'cycles') return;
            if (!confirm('Delete this element?')) return;
            laps.splice(index, 1);
            // renumber
            laps.forEach((l, i) => l.number = i + 1);
            renderLaps();
            saveToStorage();
        }

        function setElementWorkType(index, workType) {
            if (isReadOnlyMode() || workflowMode === 'cycles') return;
            if (!laps[index]) return;
            laps[index].workType = workType;
            renderLaps();
            refreshTAKT();
            saveToStorage();
        }

        function addPeriodicWorkItem(itemType) {
            if (isReadOnlyMode()) return;
            periodicWorkItems.push({
                id: Date.now(),
                name: itemType === 'changeover' ? 'Tool Change' : 'Periodic Task',
                itemType: itemType || 'periodic',
                observations: [],
                intervalUnits: '',
                remarks: ''
            });
            renderPeriodicWork();
            saveToStorage();
        }

        function deletePeriodicWorkItem(index) {
            if (isReadOnlyMode()) return;
            if (!confirm('Delete this periodic / change-over item?')) return;
            periodicWorkItems.splice(index, 1);
            renderPeriodicWork();
            saveToStorage();
        }

        function updatePeriodicField(index, field, value) {
            if (isReadOnlyMode() || !periodicWorkItems[index]) return;
            periodicWorkItems[index][field] = value;
            saveToStorage();
        }

        function renderPeriodicWork() {
            const section = document.getElementById('periodic-work-section');
            const list = document.getElementById('periodic-work-list');
            if (!section || !list) return;

            const readOnly = isReadOnlyMode();
            const hasFlaggedElements = laps.some(l => !isRegularElement(l));
            const hasItems = periodicWorkItems.length > 0 || hasFlaggedElements;
            section.classList.toggle('hidden', readOnly && !hasItems);
            const addBtns = document.getElementById('periodic-add-btns');
            if (addBtns) addBtns.classList.toggle('hidden', readOnly);

            list.innerHTML = '';
            periodicWorkItems.forEach((item, index) => {
                const stats = calculateStats(item.observations || []);
                const typeLabel = item.itemType === 'changeover' ? 'Change-over' : 'Periodic';
                const capNote = (item.itemType === 'changeover' && stats.count > 0 && item.intervalUnits > 0)
                    ? `≈ ${formatTime(Math.round(stats.avg / item.intervalUnits))}/unit`
                    : '—';

                const row = document.createElement('div');
                row.className = 'periodic-work-row grid grid-cols-1 min-[520px]:grid-cols-[minmax(0,1fr)_auto] gap-3 py-3 border-b border-zinc-800 last:border-0';
                row.innerHTML = `
                    <div class="min-w-0">
                        <div class="flex items-center gap-2 min-w-0">
                            <span class="text-[10px] uppercase tracking-wide text-amber-400 font-semibold shrink-0">${typeLabel}</span>
                            <input type="text" value="${(item.name || '').replace(/"/g, '&quot;')}" ${readOnly ? 'readonly' : ''}
                                onchange="updatePeriodicField(${index}, 'name', this.value)"
                                class="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm min-h-[44px]" placeholder="Task name">
                        </div>
                        <div class="text-[10px] text-zinc-500 font-mono mt-1 pl-0 min-[520px]:pl-[4.5rem]">Avg ${stats.count ? formatTime(stats.avg) : '—'} · Low/High ${stats.count ? formatTime(stats.min) + ' / ' + formatTime(stats.max) : '— / —'} · Cap ${capNote}</div>
                    </div>
                    <div class="flex items-end min-[520px]:items-center gap-2 flex-wrap sm:flex-nowrap shrink-0 min-[520px]:pl-0 pl-[4.5rem]">
                        <label class="flex flex-col gap-1 shrink-0">
                            <span class="text-[10px] text-zinc-500 uppercase tracking-wide flex items-center gap-0.5 whitespace-nowrap">
                                Interval
                                <button type="button" onclick="showMetricInfo('interval')" class="metric-info-btn text-zinc-500" aria-label="What is Interval?"><i class="fa-solid fa-info-circle text-[10px]"></i></button>
                            </span>
                            <input type="number" min="0" step="1" value="${item.intervalUnits || ''}" ${readOnly ? 'readonly' : ''}
                                onchange="updatePeriodicField(${index}, 'intervalUnits', parseFloat(this.value) || 0)"
                                class="w-24 bg-zinc-950 border border-zinc-700 rounded-xl px-2 py-2 text-sm font-mono text-center min-h-[44px]"
                                title="Units between events (used to calculate capacity impact per unit for change-overs)" placeholder="Units">
                        </label>
                        <div class="flex items-center gap-2">
                            <button type="button" onclick="openPeriodicModal(${index})" class="text-xs px-3 py-2 bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 rounded-xl min-h-[44px] min-w-[44px] flex items-center justify-center" title="Time observations for this item" aria-label="Time observations"><i class="fa-solid fa-clock"></i></button>
                            ${readOnly ? '' : `<button type="button" onclick="deletePeriodicWorkItem(${index})" class="text-xs px-3 py-2 text-red-400 hover:text-red-500 min-h-[44px] min-w-[44px] flex items-center justify-center" title="Delete item" aria-label="Delete item"><i class="fa-solid fa-trash"></i></button>`}
                        </div>
                    </div>
                `;
                list.appendChild(row);
            });
        }

        const METRIC_INFO = {
            fluct: {
                title: 'FLUCT (Max − Min) & FLUCT %',
                body: 'FLUCT (Max − Min) is the time spread between your fastest and slowest observations — shown in mm:ss for full cycles or individual elements. FLUCT % expresses that same range as a percentage of the average: (Max − Min) ÷ Avg × 100. Example: if avg = 40s and spread = 8s, FLUCT = 00:08.00 and FLUCT % = 20%. Lower values mean more consistent work. High FLUCT % on a specific element pinpoints method variation — a strong Kaizen target.'
            },
            performance: {
                title: 'Performance % (this station)',
                body: 'Performance compares this station\'s WACT to customer Takt. It is a process-capability signal for the station being studied — not overall line performance. Near or under 100% means this station can meet demand at the pace measured. Combine multiple station studies in Line Balance & Reporting for true line metrics.'
            },
            wact: {
                title: 'WACT / Avg Cycle',
                body: 'WACT is your observed work pace from this study — element standards summed, or average cycle plus allowance. It reflects how the job is actually running today, not the customer demand target.'
            },
            takt: {
                title: 'Takt Time',
                body: 'Takt is the customer-driven pace: available productive minutes divided by units needed. In a single study, compare this station\'s WACT to Takt for process capability. True line TACT and balance come from combining multiple station studies in Line Balance & Reporting. Staffing performance (OR%) is calculated separately.'
            },
            wactResult: {
                title: 'Current WACT (this station)',
                body: 'Live WACT from this station\'s study — element standards summed, or average cycle plus allowance. Compare to Takt for station-level process capability. Line speed and balance are calculated when multiple station studies are combined in Line Balance & Reporting.'
            },
            headroom: {
                title: 'Headroom to Takt (this station)',
                body: 'Headroom is the gap between Takt and this station\'s WACT. Positive headroom means this station is faster than required (buffer at this station). Negative means this station is slower than Takt. Use Line Balance & Reporting to see which station sets line TACT and overall balance.'
            },
            allowance: {
                title: 'Allowance %',
                body: 'Allowance adds normal fatigue, personal needs, and minor delays to observed times. Standard Time = average observed time × (1 + allowance%). Typical manufacturing allowance is 10–15%; adjust to match your site policy.'
            },
            variance: {
                title: 'Element FLUCT %',
                body: 'FLUCT % on each element is the observation range as a percentage of average: (Max − Min) ÷ Avg × 100. High FLUCT % on one element pinpoints inconsistent method — a good place to standardize or train.'
            },
            availableWorkTime: {
                title: 'Available Work Time',
                body: 'This is productive time left after subtracting breaks and non-value-added time from the shift. Takt uses this number — not raw shift length — so meetings and changeovers do not distort the pace calculation.'
            },
            interval: {
                title: 'Interval (units)',
                body: 'Units between events — how many regular units are produced between each occurrence of this periodic or change-over task. Used to calculate capacity impact per unit for change-overs (avg task time ÷ interval).'
            }
        };

        function showMetricInfo(key) {
            const info = METRIC_INFO[key];
            if (!info) return;
            const titleEl = document.getElementById('metric-info-title');
            const bodyEl = document.getElementById('metric-info-body');
            const modal = document.getElementById('metric-info-modal');
            if (!titleEl || !bodyEl || !modal) return;
            titleEl.textContent = info.title;
            bodyEl.textContent = info.body;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        function closeMetricInfo() {
            const modal = document.getElementById('metric-info-modal');
            if (!modal) return;
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }

        // ---------- Standardization Document ----------
        function escapeStdDocHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function sanitizeStdDocRichHtml(html) {
            if (!html) return '';
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            tmp.querySelectorAll('script, style, iframe, object, embed').forEach(el => el.remove());
            tmp.querySelectorAll('*').forEach(el => {
                [...el.attributes].forEach(attr => {
                    if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
                });
            });
            return tmp.innerHTML;
        }

        function getCaptureStudySnapshot() {
            const allowance = getAllowance();
            const { shift, shiftCustom } = getShiftFromUI();
            const demand = parseFloat(document.getElementById('takt-demand')?.value) || 0;
            const shiftHrs = parseFloat(document.getElementById('takt-shift-hours')?.value) || 0;
            const breaksMin = parseFloat(document.getElementById('takt-breaks-min')?.value) || 0;
            const wactSec = getCurrentWACT();
            const taktSec = computeTaktSeconds(demand, shiftHrs, breaksMin);
            let headroomPct = null;
            if (wactSec > 0 && taktSec > 0) {
                headroomPct = Math.round((1 - wactSec / taktSec) * 100);
            }

            const elementsWithStandards = laps.map((lap, idx) => {
                const st = calculateStats(lap.observations || []);
                return {
                    ...lap,
                    number: lap.number || (idx + 1),
                    name: lap.name || `Element ${idx + 1}`,
                    observations: lap.observations || [],
                    standardTime: st.count > 0 ? getStandardTime(st.avg, allowance) : null,
                    obsAvg: st.count > 0 ? st.avg : null,
                    obsMin: st.count > 0 ? st.min : null,
                    obsMax: st.count > 0 ? st.max : null,
                    obsStd: st.count > 0 ? st.std : null,
                    obsCount: st.count
                };
            });
            return {
                studyName: document.getElementById('study-name')?.value.trim() || 'Untitled Study',
                area: document.getElementById('area-select')?.value || 'Unspecified',
                station: document.getElementById('station-input')?.value?.trim() || '',
                ...getCaptureMetaFields(),
                shift,
                shiftCustom,
                date: document.getElementById('study-date')?.value || new Date().toISOString().split('T')[0],
                createdBy: currentUser?.name || 'Unknown',
                allowancePct: allowance,
                workflowMode,
                laps: elementsWithStandards,
                cycleTimes: [...cycleTimes],
                periodicWorkItems: JSON.parse(JSON.stringify(periodicWorkItems)),
                workInstructions: JSON.parse(JSON.stringify(workInstructions)),
                metrics: { wactSec, taktSec, headroomPct, taktDemand: demand, taktShiftHours: shiftHrs, taktBreaksMin: breaksMin }
            };
        }

        function studyHasDocumentData(study) {
            if (!study) return false;
            if (study.workflowMode === 'cycles') {
                const hasCycles = (study.cycleTimes?.length || 0) > 0;
                const hasElementObs = (study.laps || []).some(l => (l.observations || []).length > 0);
                return hasCycles || hasElementObs;
            }
            return (study.laps?.length || 0) > 0;
        }

        function buildStdDocElementsTable(study, allowance) {
            const regularLaps = (study.laps || []).filter(isRegularElement);
            if (!regularLaps.length) return '';

            let totalStdMs = 0;
            const rows = regularLaps.map((lap) => {
                const st = getLapStats(lap, allowance);
                if (st.standardTime) totalStdMs += st.standardTime;
                return buildStdDocElementRow(lap, lap.number || 1, allowance, true);
            }).join('');

            const hasObs = regularLaps.some(l => (l.observations || []).length > 0);
            if (!hasObs) return '';

            return `
                <div class="std-doc-section-title">Work Elements — Isolated Observations</div>
                <p class="std-doc-note">Element observations recorded via Element Lap during cycle timing. Allowance: ${allowance}% &nbsp;·&nbsp; Standard Time = Avg × (1 + allowance%)</p>
                <table class="std-doc-table std-doc-table-bordered">
                    <thead><tr>
                        <th>#</th><th>Work Element</th><th>Low</th><th>Avg</th><th>High</th><th>Std Dev</th><th>Std Time</th><th>FLUCT %</th><th>Remarks</th>
                    </tr></thead>
                    <tbody>${rows}
                        <tr class="std-doc-total">
                            <td colspan="2">Sum of Element Standards (reference)</td>
                            <td colspan="4"></td>
                            <td class="mono std-doc-std">${totalStdMs > 0 ? formatTime(totalStdMs) : '—'}</td>
                            <td colspan="2">Compare to WACT from cycles</td>
                        </tr>
                    </tbody>
                </table>`;
        }

        function buildStdDocHeaderCell(label, value) {
            return `<td><span class="std-doc-hdr-lbl">${label}</span><span class="std-doc-hdr-val">${value}</span></td>`;
        }

        function buildStdDocElementRow(lap, idx, allowance, includeInWact) {
            const st = getLapStats(lap, allowance);
            if (includeInWact && st.standardTime) {
                // counted by caller
            }
            const name = escapeStdDocHtml(lap.name || `Element ${idx + 1}`);
            const num = lap.number || (idx + 1);
            const typeTag = lap.workType && lap.workType !== 'regular'
                ? `<span class="std-doc-type-tag">${lap.workType === 'changeover' ? 'C/O' : 'PER'}</span> `
                : '';
            return `<tr>
                <td class="std-doc-num">${num}</td>
                <td>${typeTag}${name}</td>
                <td class="mono">${st.count > 0 ? formatTime(st.min) : '—'}</td>
                <td class="mono">${st.count > 0 ? formatTime(st.avg) : '—'}</td>
                <td class="mono">${st.count > 0 ? formatTime(st.max) : '—'}</td>
                <td class="mono">${st.count > 0 ? formatTime(st.std) : '—'}</td>
                <td class="mono std-doc-std">${st.standardTime ? formatTime(st.standardTime) : '—'}</td>
                <td class="mono">${st.count >= 2 ? formatFluctPctDisplay(st.min, st.max, st.avg) : '—'}</td>
                <td class="std-doc-remarks"></td>
            </tr>`;
        }

        function buildStdDocPeriodicRows(study, allowance) {
            const rows = [];
            let n = 0;

            (study.laps || []).forEach((lap, idx) => {
                if (isRegularElement(lap)) return;
                const st = getLapStats(lap, allowance);
                const typeLabel = lap.workType === 'changeover' ? 'Change-over' : 'Periodic';
                const fluctNote = st.count >= 2 ? ' · FLUCT ' + formatFluctPctDisplay(st.min, st.max, st.avg) : '';
                rows.push(`<tr>
                    <td class="std-doc-num">${++n}</td>
                    <td>${escapeStdDocHtml(lap.name || `Element ${idx + 1}`)}</td>
                    <td>${typeLabel}</td>
                    <td class="mono">${st.count > 0 ? formatTime(st.min) : '—'}</td>
                    <td class="mono">${st.count > 0 ? formatTime(st.avg) : '—'}</td>
                    <td class="mono">${st.count > 0 ? formatTime(st.max) : '—'}</td>
                    <td class="mono">—</td>
                    <td class="mono">Excluded from WACT</td>
                    <td class="std-doc-remarks">Flagged element${fluctNote}</td>
                </tr>`);
            });

            (study.periodicWorkItems || []).forEach(item => {
                const st = calculateStats(item.observations || []);
                const typeLabel = item.itemType === 'changeover' ? 'Change-over' : 'Periodic';
                const capImpact = (item.itemType === 'changeover' && st.count > 0 && item.intervalUnits > 0)
                    ? formatTime(Math.round(st.avg / item.intervalUnits)) + '/unit'
                    : (st.count > 0 ? formatTime(st.avg) + ' (batch)' : '—');
                rows.push(`<tr>
                    <td class="std-doc-num">${++n}</td>
                    <td>${escapeStdDocHtml(item.name || 'Task')}</td>
                    <td>${typeLabel}</td>
                    <td class="mono">${st.count > 0 ? formatTime(st.min) : '—'}</td>
                    <td class="mono">${st.count > 0 ? formatTime(st.avg) : '—'}</td>
                    <td class="mono">${st.count > 0 ? formatTime(st.max) : '—'}</td>
                    <td class="mono">${item.intervalUnits > 0 ? item.intervalUnits + ' units' : '—'}</td>
                    <td class="mono">${capImpact}</td>
                    <td class="std-doc-remarks">${escapeStdDocHtml(item.remarks || '')}</td>
                </tr>`);
            });

            return rows.join('');
        }

        function buildStandardizationDocumentHTML(study) {
            const allowance = study.allowancePct || 12;
            const station = study.station?.trim() || '—';
            const generatedAt = new Date().toLocaleString();
            const metrics = getStudyMetrics(study);
            const availMin = getStudyAvailableWorkMin(study);
            const demand = study.metrics?.taktDemand;
            const taktDisplay = metrics.taktSec ? formatTime(metrics.taktSec * 1000) : '—';
            const wactDisplay = metrics.wactSec ? formatTime(metrics.wactSec) : '—';
            const headroom = metrics.headroomPct != null ? metrics.headroomPct + '%' : '—';

            let cycleFluct = '—';
            let cycleFluctPct = '—';
            if (study.workflowMode === 'cycles' && study.cycleTimes?.length > 1) {
                const min = Math.min(...study.cycleTimes);
                const max = Math.max(...study.cycleTimes);
                const avg = study.cycleTimes.reduce((a, b) => a + b, 0) / study.cycleTimes.length;
                cycleFluct = formatTime(max - min);
                cycleFluctPct = formatFluctPctDisplay(min, max, Math.round(avg));
            }

            let elementsSection = '';
            let totalStdMs = 0;

            if (study.workflowMode === 'cycles' && study.cycleTimes?.length) {
                const avg = study.cycleTimes.reduce((a, b) => a + b, 0) / study.cycleTimes.length;
                const min = Math.min(...study.cycleTimes);
                const max = Math.max(...study.cycleTimes);
                const stdCycle = getStandardTime(Math.round(avg), allowance);
                totalStdMs = stdCycle;
                const rows = study.cycleTimes.map((t, i) =>
                    `<tr>
                        <td class="std-doc-num">${i + 1}</td>
                        <td>Cycle ${i + 1}</td>
                        <td class="mono">${formatTime(t)}</td>
                        <td class="mono">${formatTime(t)}</td>
                        <td class="mono">${formatTime(t)}</td>
                        <td class="mono">—</td>
                        <td class="mono">—</td>
                        <td class="mono">—</td>
                        <td class="std-doc-remarks"></td>
                    </tr>`
                ).join('');
                elementsSection = `
                    <div class="std-doc-section-title">Cycle Observations</div>
                    <table class="std-doc-table std-doc-table-bordered">
                        <thead><tr>
                            <th>#</th><th>Cycle</th><th>Low</th><th>Avg</th><th>High</th><th>Std Dev</th><th>Std Time</th><th>FLUCT %</th><th>Remarks</th>
                        </tr></thead>
                        <tbody>${rows}
                            <tr class="std-doc-total">
                                <td colspan="2">Standard Cycle (Avg + ${allowance}% allowance)</td>
                                <td class="mono">${formatTime(min)}</td>
                                <td class="mono">${formatTime(Math.round(avg))}</td>
                                <td class="mono">${formatTime(max)}</td>
                                <td class="mono">—</td>
                                <td class="mono std-doc-std">${formatTime(stdCycle)}</td>
                                <td class="mono">${study.cycleTimes.length > 1 ? formatFluctPctDisplay(min, max, Math.round(avg)) : '—'}</td>
                                <td>WACT</td>
                            </tr>
                        </tbody>
                    </table>`;
                const elementDetail = buildStdDocElementsTable(study, allowance);
                if (elementDetail) elementsSection += elementDetail;
            } else if (study.laps?.length) {
                const regularLaps = study.laps.filter(isRegularElement);
                const rows = regularLaps.map((lap) => {
                    const st = getLapStats(lap, allowance);
                    if (st.standardTime) totalStdMs += st.standardTime;
                    return buildStdDocElementRow(lap, lap.number || 1, allowance, true);
                }).join('');
                elementsSection = `
                    <div class="std-doc-section-title">Work Elements — Standard Times</div>
                    <p class="std-doc-note">Allowance: ${allowance}% &nbsp;·&nbsp; Standard Time = Avg × (1 + allowance%) &nbsp;·&nbsp; Periodic / change-over items listed separately below</p>
                    <table class="std-doc-table std-doc-table-bordered">
                        <thead><tr>
                            <th>#</th><th>Work Element</th><th>Low</th><th>Avg</th><th>High</th><th>Std Dev</th><th>Std Time</th><th>FLUCT %</th><th>Remarks</th>
                        </tr></thead>
                        <tbody>${rows || `<tr><td colspan="9" style="color:#71717a;">No regular elements recorded.</td></tr>`}
                            <tr class="std-doc-total">
                                <td colspan="2">Total Standard Time (WACT)</td>
                                <td colspan="4"></td>
                                <td class="mono std-doc-std">${totalStdMs > 0 ? formatTime(totalStdMs) : '—'}</td>
                                <td colspan="2">sec/unit pace target</td>
                            </tr>
                        </tbody>
                    </table>`;
            } else {
                elementsSection = '<p class="std-doc-note">No timing data recorded.</p>';
            }

            const periodicRows = buildStdDocPeriodicRows(study, allowance);
            let periodicSection = '';
            if (periodicRows) {
                periodicSection = `
                    <div class="std-doc-section-title">Periodic Work &amp; Change-overs</div>
                    <p class="std-doc-note">Non-regular work timed separately — not included in WACT. Capacity impact shows amortized time per unit when interval is known.</p>
                    <table class="std-doc-table std-doc-table-bordered std-doc-periodic-table">
                        <thead><tr>
                            <th>#</th><th>Process / Task</th><th>Type</th><th>Low</th><th>Avg</th><th>High</th><th>Interval</th><th>Cap. Impact</th><th>Remarks</th>
                        </tr></thead>
                        <tbody>${periodicRows}</tbody>
                    </table>`;
            }

            let wiSection = '';
            const instructions = study.workInstructions || [];
            if (instructions.length) {
                const steps = instructions.map((instr, idx) => {
                    const body = sanitizeStdDocRichHtml(instr.html || '');
                    const img = instr.imageBase64
                        ? `<img src="${instr.imageBase64}" alt="Step ${idx + 1}" class="std-doc-wi-img">`
                        : '';
                    return `<div class="std-doc-wi-step">
                        <span class="std-doc-wi-num">${idx + 1}</span>
                        <div class="std-doc-wi-body">${body || '<em>No text for this step.</em>'}${img}</div>
                    </div>`;
                }).join('');
                wiSection = `<div class="std-doc-section-title">Work Instructions</div>${steps}`;
            }

            const kpiFluct = study.workflowMode === 'cycles' ? cycleFluct : '—';
            const kpiFluctPct = study.workflowMode === 'cycles' ? cycleFluctPct : '—';

            return `<div class="std-doc-paper">
                <header class="std-doc-brand">
                    <div class="std-doc-brand-mark">
                        <div class="std-doc-brand-icon"><i class="fa-solid fa-industry"></i></div>
                        <span class="std-doc-brand-name">StdWork</span>
                    </div>
                    <div class="std-doc-doc-type">Standardization Document</div>
                </header>
                <h1 class="std-doc-sheet-title">Standard Work — Process Capacity &amp; Instruction Sheet</h1>
                <h2 class="std-doc-title">${escapeStdDocHtml(study.studyName || 'Untitled Study')}</h2>

                <table class="std-doc-header-grid">
                    <tr>
                        ${buildStdDocHeaderCell('Operation / Part', escapeStdDocHtml(study.studyName || '—'))}
                        ${buildStdDocHeaderCell('Date', escapeStdDocHtml(study.date || '—'))}
                        ${buildStdDocHeaderCell('Operator / TMO', escapeStdDocHtml(study.createdBy || '—'))}
                    </tr>
                    <tr>
                        ${buildStdDocHeaderCell('Area / Line', escapeStdDocHtml(study.area || '—'))}
                        ${buildStdDocHeaderCell('Station', escapeStdDocHtml(station))}
                        ${buildStdDocHeaderCell('Shift', escapeStdDocHtml(getShiftLabel(study)))}
                    </tr>
                    <tr>
                        ${buildStdDocHeaderCell('Daily Demand', demand > 0 ? demand + ' units/shift' : '—')}
                        ${buildStdDocHeaderCell('Available Time', availMin != null ? availMin + ' min/shift' : '—')}
                        ${buildStdDocHeaderCell('Takt Time', taktDisplay)}
                    </tr>
                    <tr>
                        ${buildStdDocHeaderCell('Observed Operator', escapeStdDocHtml(study.observedOperator || '—'))}
                        ${buildStdDocHeaderCell('Part / SKU', escapeStdDocHtml(study.partNumber || '—'))}
                        ${buildStdDocHeaderCell('Target Output / Line Speed', study.targetOutput != null ? escapeStdDocHtml(String(study.targetOutput)) : '—')}
                    </tr>
                </table>

                <table class="std-doc-kpi-grid">
                    <tr>
                        <td><span class="std-doc-hdr-lbl">WACT / Std Time</span><span class="std-doc-hdr-val mono std-doc-std">${wactDisplay}</span></td>
                        <td><span class="std-doc-hdr-lbl">Allowance</span><span class="std-doc-hdr-val">${allowance}%</span></td>
                        <td><span class="std-doc-hdr-lbl">Headroom to Takt</span><span class="std-doc-hdr-val">${headroom}</span></td>
                        <td><span class="std-doc-hdr-lbl">FLUCT (Max−Min)</span><span class="std-doc-hdr-val mono">${kpiFluct}</span></td>
                        <td><span class="std-doc-hdr-lbl">FLUCT %</span><span class="std-doc-hdr-val mono">${kpiFluctPct}</span></td>
                    </tr>
                </table>

                ${elementsSection}
                ${periodicSection}
                ${wiSection}
                <div class="std-doc-section-title">Approval</div>
                <div class="std-doc-signatures">
                    <div class="std-doc-sig-block"><div class="std-doc-sig-line"></div><div class="std-doc-sig-label">Prepared By</div></div>
                    <div class="std-doc-sig-block"><div class="std-doc-sig-line"></div><div class="std-doc-sig-label">Supervisor</div></div>
                    <div class="std-doc-sig-block"><div class="std-doc-sig-line"></div><div class="std-doc-sig-label">Date Approved</div></div>
                </div>
                <div class="std-doc-footer">Generated by StdWork · ${escapeStdDocHtml(generatedAt)}</div>
            </div>`;
        }

        function openStandardizationDocument(study) {
            if (!studyHasDocumentData(study)) {
                alert('No timing data available to generate a standardization document.');
                return;
            }
            const content = document.getElementById('std-doc-content');
            const modal = document.getElementById('std-doc-modal');
            if (!content || !modal) return;
            content.innerHTML = buildStandardizationDocumentHTML(study);
            modal.dataset.studyName = study.studyName || 'Study';
            modal.dataset.studyDate = study.date || new Date().toISOString().split('T')[0];
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            const scroll = document.getElementById('std-doc-scroll');
            if (scroll) scroll.scrollTop = 0;
        }

        function openStandardizationDocumentFromCapture() {
            const snapshot = getCaptureStudySnapshot();
            openStandardizationDocument(snapshot);
        }

        function openStandardizationDocumentFromStudy(studyId) {
            const study = studies.find(s => s.id === studyId);
            if (!study) return;
            openStandardizationDocument(study);
        }

        function closeStandardizationDocument() {
            const modal = document.getElementById('std-doc-modal');
            if (!modal) return;
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }

        function getStdDocPdfFilename() {
            const modal = document.getElementById('std-doc-modal');
            const rawName = modal?.dataset.studyName || 'Study';
            const safeName = rawName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'Study';
            const date = modal?.dataset.studyDate || new Date().toISOString().split('T')[0];
            return `StdWork_${safeName}_${date}.pdf`;
        }

        function buildStdDocExportNode(paper) {
            const exportNode = paper.cloneNode(true);
            exportNode.style.width = '8.5in';
            exportNode.style.maxWidth = '8.5in';
            exportNode.style.padding = '0.65in 0.75in';
            exportNode.style.fontSize = '11pt';
            exportNode.style.transform = 'none';
            exportNode.style.boxShadow = 'none';
            exportNode.style.margin = '0';
            const holder = document.createElement('div');
            holder.className = 'std-doc-export-holder';
            holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:8.5in;background:#fff;z-index:-1';
            holder.appendChild(exportNode);
            document.body.appendChild(holder);
            return { exportNode, holder };
        }

        function fallbackPrintStandardizationDocument() {
            const modal = document.getElementById('std-doc-modal');
            if (!modal || modal.classList.contains('hidden')) return;
            document.body.classList.add('std-doc-printing');
            const cleanup = () => {
                document.body.classList.remove('std-doc-printing');
                window.removeEventListener('afterprint', cleanup);
            };
            window.addEventListener('afterprint', cleanup);
            window.print();
        }

        async function downloadStandardizationDocumentPdf() {
            const paper = document.querySelector('#std-doc-content .std-doc-paper');
            if (!paper) return;

            const btn = document.getElementById('std-doc-download-btn');
            const origHtml = btn?.innerHTML;
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Generating…</span>';
            }

            const filename = getStdDocPdfFilename();
            let holder = null;

            try {
                if (typeof html2pdf === 'undefined') {
                    throw new Error('html2pdf unavailable');
                }

                const built = buildStdDocExportNode(paper);
                holder = built.holder;

                await html2pdf().set({
                    margin: [0.35, 0.4, 0.35, 0.4],
                    filename,
                    pagebreak: { mode: ['css', 'legacy'], avoid: ['.std-doc-wi-step', 'tr'] },
                    image: { type: 'jpeg', quality: 0.96 },
                    html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
                    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
                }).from(built.exportNode).save();
            } catch (err) {
                console.warn('StdWork PDF download fallback:', err);
                if (typeof html2pdf === 'undefined') {
                    alert('PDF download requires network access for the PDF library. Use the print dialog and choose Save as PDF.');
                }
                fallbackPrintStandardizationDocument();
            } finally {
                if (holder?.parentNode) holder.parentNode.removeChild(holder);
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = origHtml;
                }
            }
        }