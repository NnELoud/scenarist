const { ipcRenderer } = require('electron');

// Основной класс приложения
class ScenaristApp {
    constructor() {
        this.notes = [];
        this.connections = [];
        this.selectedNote = null;
        this.isDarkTheme = false;
        this.nextNoteId = 1;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.selectedNotes = []; // Массив для множественного выделения
        this.zoom = 1;
        this.workspace = document.getElementById('workspace');
        // Делаем рабочую область очень большой
        this.workspace.style.width = '50000px';
        this.workspace.style.height = '50000px';
        this.lastMousePos = { x: 200, y: 200 };
        this.isNewProject = true; // Флаг для определения нового проекта
        
        this.init();

        // IPC подписки внутри конструктора
        ipcRenderer.on('request-save-before-exit', () => {
            console.log('[EXIT] Запрошено сохранение перед выходом');
            this.saveScenario(() => {
                console.log('[EXIT] Сохранено, отправляю save-and-exit');
                ipcRenderer.send('project-saved');
                ipcRenderer.send('save-and-exit');
            });
        });
        ipcRenderer.on('file-saved', (event, filePath) => {
            if (filePath) {
                console.log('[SAVE] Сценарий сохранён в', filePath);
                ipcRenderer.send('project-saved');
                if (this._onSavedCallback) this._onSavedCallback();
                ipcRenderer.send('save-and-exit');
            } else {
                console.log('[SAVE] Сохранение отменено');
            }
        });
        
        // Обработка загрузки файла сценария при запуске
        ipcRenderer.on('load-scenario-file', (event, data) => {
            console.log('[LOAD] Загрузка сценария при запуске');
            this.isNewProject = false; // Это не новый проект
            if (data && data.startsWith('SCENv1:')) {
                const base64 = data.slice(7);
                const json = decodeURIComponent(escape(atob(base64)));
                const scenario = JSON.parse(json);
                this.loadScenarioData(scenario);
            } else {
                console.log('[LOAD] Неверный формат файла');
                alert('Неверный формат файла!');
            }
        });
        
        // Обработка начала нового проекта
        ipcRenderer.on('start-new-project', () => {
            console.log('[NEW] Начинаем новый проект');
            this.isNewProject = true; // Это новый проект
            // Sample notes уже созданы в init()
        });
    }
    
    init() {
        this.bindEvents();
        this.loadTheme();
        // Создаём sample notes только если это новый проект
        if (this.isNewProject) {
            this.createSampleNotes();
        }
        this.render();
    }
    
    bindEvents() {
        // Кнопки в заголовке
        document.getElementById('newNote').addEventListener('click', () => this.createNote());
        document.getElementById('connectNotes').addEventListener('click', () => this.connectSelectedNotes());
        document.getElementById('saveScenario').addEventListener('click', () => this.saveScenario());
        document.getElementById('loadScenario').addEventListener('click', () => this.loadScenario());
        document.getElementById('toggleTheme').addEventListener('click', () => this.toggleTheme());
        
        // Рабочая область
        this.workspace.addEventListener('click', (e) => this.handleWorkspaceClick(e));
        this.workspace.addEventListener('contextmenu', (e) => this.handleWorkspaceContextMenu(e));
        
        // Глобальные события
        document.addEventListener('click', (e) => this.handleGlobalClick(e));
        document.addEventListener('keydown', (e) => this.handleKeydown(e));
        
        // Добавляем обработчик для Ctrl+клик для множественного выделения
        document.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        
        // Зум колесиком мыши
        this.workspace.addEventListener('wheel', (e) => this.handleZoom(e));
        
        // Отслеживаем позицию мыши для быстрого создания заметки
        this.workspace.addEventListener('mousemove', (e) => {
            const rect = this.workspace.getBoundingClientRect();
            this.lastMousePos = {
                x: (e.clientX - rect.left) / this.zoom,
                y: (e.clientY - rect.top) / this.zoom
            };
        });
        
        // Drag-scroll по среднему клику мыши
        let isMiddleDragging = false;
        let lastDragPos = { x: 0, y: 0 };
        this.workspace.addEventListener('mousedown', (e) => {
            if (e.button === 1) { // средняя кнопка
                isMiddleDragging = true;
                lastDragPos = { x: e.clientX, y: e.clientY };
                this.workspace.style.cursor = 'grab';
                e.preventDefault();
            }
        });
        window.addEventListener('mousemove', (e) => {
            if (isMiddleDragging) {
                const dx = e.clientX - lastDragPos.x;
                const dy = e.clientY - lastDragPos.y;
                lastDragPos = { x: e.clientX, y: e.clientY };
                // Скроллим родителя (main/main или body)
                const container = this.workspace.parentElement;
                container.scrollLeft -= dx / this.zoom;
                container.scrollTop -= dy / this.zoom;
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (isMiddleDragging && e.button === 1) {
                isMiddleDragging = false;
                this.workspace.style.cursor = '';
            }
        });
    }
    
    handleZoom(e) {
        e.preventDefault();
        const scaleStep = 0.1;
        if (e.deltaY < 0) {
            this.zoom = Math.min(this.zoom + scaleStep, 2);
        } else {
            this.zoom = Math.max(this.zoom - scaleStep, 0.3);
        }
        this.workspace.style.transform = `scale(${this.zoom})`;
        this.workspace.style.transformOrigin = '0 0';
    }
    
    render() {
        this.workspace.innerHTML = '';
        this.workspace.style.transform = `scale(${this.zoom})`;
        this.workspace.style.transformOrigin = '0 0';
        this.notes.forEach(note => this.renderNote(note));
        this.connections.forEach(conn => this.renderConnection(conn));
        this.updateConnectButton();
    }
    
    renderNote(note) {
        const noteElement = document.createElement('div');
        noteElement.className = 'note';
        noteElement.id = `note-${note.id}`;
        noteElement.style.left = note.x + 'px';
        noteElement.style.top = note.y + 'px';
        noteElement.style.width = (note.width || 200) + 'px';
        if (this.selectedNotes.some(n => n.id === note.id)) {
            noteElement.classList.add('selected');
        }
        if (!note.images) note.images = [];
        if (!note.audios) note.audios = [];
        if (note.important === undefined) note.important = false;
        noteElement.innerHTML = `
            <div class="note-header">
                <button class="note-star" title="Важно" style="position:absolute;left:2px;top:2px;background:none;z-index:2;">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="${note.important ? '#FFD600' : 'none'}" stroke="#FFD600" stroke-width="1.5"><polygon points="10,2 12.4,7.5 18,8 13.5,12 15,18 10,14.5 5,18 6.5,12 2,8 7.6,7.5"/></svg>
                </button>
                <div class="note-title" tabindex="0">${note.title || 'Без названия'}</div>
                <input class="note-title-input" style="display:none;font-weight:600;font-size:1.1em;line-height:1.2;margin-left:24px;margin-top:2px;background:transparent;border:none;color:inherit;width:calc(100% - 28px);" maxlength="60" value="${note.title || ''}" />
                <button class="note-photo" title="Добавить фото" tabindex="-1">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="5" width="16" height="11" rx="2" stroke="#2196F3" stroke-width="1.5"/><circle cx="7" cy="10" r="2" stroke="#2196F3" stroke-width="1.5"/><path d="M2 14l4-4a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 0 2.8 0L18 10" stroke="#2196F3" stroke-width="1.5"/></svg>
                </button>
                <button class="note-audio" title="Добавить аудио" tabindex="-1">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#4caf50" stroke-width="1.7"><rect x="7" y="3" width="6" height="10" rx="3"/><path d="M10 16v2" stroke-linecap="round"/><path d="M7 13a3 3 0 0 0 6 0"/></svg>
                </button>
                <button class="note-close" title="Удалить заметку" tabindex="-1">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#f44336" stroke-width="1.5"/><path d="M7 7l6 6M13 7l-6 6" stroke="#f44336" stroke-width="1.5"/></svg>
                </button>
            </div>
            <textarea class="note-content" placeholder="Введите текст заметки..."></textarea>
            <div class="note-images"></div>
            <div class="note-audios"></div>
            <div class="note-resizer"></div>
        `;
        this.makeNoteDraggable(noteElement, note);
        // --- Редактирование заголовка ---
        const titleDiv = noteElement.querySelector('.note-title');
        const titleInput = noteElement.querySelector('.note-title-input');
        titleDiv.onclick = () => {
            titleDiv.style.display = 'none';
            titleInput.style.display = '';
            titleInput.focus();
            titleInput.select();
        };
        titleInput.onblur = () => {
            titleInput.style.display = 'none';
            titleDiv.style.display = '';
            note.title = titleInput.value.trim() || 'Без названия';
            titleDiv.textContent = note.title;
            this.notifyProjectChanged();
        };
        titleInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                titleInput.blur();
            }
        };
        // --- Звёздочка ---
        const starBtn = noteElement.querySelector('.note-star');
        starBtn.onclick = (e) => {
            e.stopPropagation();
            note.important = !note.important;
            starBtn.querySelector('svg').setAttribute('fill', note.important ? '#FFD600' : 'none');
            this.render();
        };
        // --- Удаление ---
        noteElement.querySelector('.note-close').onclick = (e) => {
            e.stopPropagation();
            this.deleteNote(note.id);
            this.render();
        };
        // --- Ресайзер заметки ---
        const resizer = noteElement.querySelector('.note-resizer');
        resizer.style.position = 'absolute';
        resizer.style.right = '0';
        resizer.style.bottom = '0';
        resizer.style.width = '18px';
        resizer.style.height = '18px';
        resizer.style.cursor = 'nwse-resize';
        resizer.style.background = 'none';
        resizer.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 16L16 2M10 16h6v-6" stroke="#2196F3" stroke-width="1.5" fill="none"/></svg>`;
        let resizing = false;
        resizer.onmousedown = (e) => {
            e.stopPropagation();
            resizing = true;
            let startX = e.clientX, startY = e.clientY;
            let startW = note.width, startH = note.height;
            document.onmousemove = (ev) => {
                if (!resizing) return;
                let dw = ev.clientX - startX;
                let dh = ev.clientY - startY;
                note.width = Math.max(140, Math.min(500, startW + dw));
                note.height = Math.max(100, Math.min(400, startH + dh));
                noteElement.style.width = note.width + 'px';
                noteElement.style.height = note.height + 'px';
            };
            document.onmouseup = () => {
                resizing = false;
                document.onmousemove = null;
                document.onmouseup = null;
                // Сохраняем размеры заметки после ресайза
                note.width = noteElement.offsetWidth;
                note.height = noteElement.offsetHeight;
                this.notifyProjectChanged();
            };
        };
        // --- Drag по всей заметке ---
        noteElement.onmousedown = (e) => {
            // Не начинаем drag, если клик по textarea, input, кнопке или svg
            if (e.target.closest('textarea') || e.target.closest('button') || e.target.closest('svg')) return;
            if (e.ctrlKey) return;
            this.isDragging = true;
            this.dragNote = note;
            this.dragOffset.x = e.clientX - note.x;
            this.dragOffset.y = e.clientY - note.y;
            noteElement.style.cursor = 'grabbing';
            document.onmousemove = (ev) => {
                if (!this.isDragging) return;
                note.x = (ev.clientX - this.dragOffset.x);
                note.y = (ev.clientY - this.dragOffset.y);
                this.render();
            };
            document.onmouseup = () => {
                this.isDragging = false;
                noteElement.style.cursor = 'move';
                document.onmousemove = null;
                document.onmouseup = null;
            };
        };
        noteElement.ondragover = (e) => { e.preventDefault(); noteElement.classList.add('dragover'); };
        noteElement.ondragleave = (e) => { noteElement.classList.remove('dragover'); };
        noteElement.ondrop = (e) => {
            e.preventDefault();
            noteElement.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (ev2) => {
                        note.images.push({src: ev2.target.result, w: 120, h: 80});
                        this.render();
                    };
                    reader.readAsDataURL(file);
                } else if (file.type.startsWith('audio/')) {
                    const reader = new FileReader();
                    reader.onload = (ev2) => {
                        note.audios.push({src: ev2.target.result, name: file.name});
                        this.render();
                    };
                    reader.readAsDataURL(file);
                }
            }
        };
        noteElement.querySelector('.note-content').onpaste = (e) => {
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    const reader = new FileReader();
                    reader.onload = (ev2) => {
                        note.images.push({src: ev2.target.result, w: 120, h: 80});
                        this.render();
                    };
                    reader.readAsDataURL(file);
                } else if (items[i].type.indexOf('audio') !== -1) {
                    const file = items[i].getAsFile();
                    const reader = new FileReader();
                    reader.onload = (ev2) => {
                        note.audios.push({src: ev2.target.result, name: file.name});
                        this.render();
                    };
                    reader.readAsDataURL(file);
                }
            }
        };
        const textarea = noteElement.querySelector('.note-content');
        textarea.value = note.content || '';
        textarea.style.overflow = 'hidden';
        textarea.style.resize = 'none';
        textarea.style.width = '100%';
        textarea.style.boxSizing = 'border-box';
        textarea.style.minHeight = '60px';
        textarea.style.maxHeight = 'none';
        textarea.oninput = (e) => {
            if (!note) return;
            note.content = e.target.value;
            textarea.style.height = 'auto';
            textarea.style.height = (textarea.scrollHeight) + 'px';
            // Гарантируем, что note.height всегда >= scrollHeight + запас
            const minHeight = textarea.scrollHeight + 40;
            if (!note.height || note.height < minHeight) note.height = minHeight;
            noteElement.style.height = note.height + 'px';
            this.notifyProjectChanged();
        };
        textarea.onfocus = () => this.selectSingleNote(note);
        // После рендера — если note.height меньше нужного, увеличиваем
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight) + 'px';
        const minHeight = textarea.scrollHeight + 40;
        if (!note.height || note.height < minHeight) note.height = minHeight;
        noteElement.style.height = note.height + 'px';
        // --- Исправление: textarea занимает всё пространство заметки ---
        const header = noteElement.querySelector('.note-header');
        const headerH = header ? header.offsetHeight : 0;
        const padding = 24; // внутренние отступы
        const available = note.height - headerH - padding;
        if (available > 40) textarea.style.height = available + 'px';
        // Фото внутри заметки
        const imagesDiv = noteElement.querySelector('.note-images');
        imagesDiv.style.display = 'flex';
        imagesDiv.style.flexWrap = 'wrap';
        imagesDiv.style.gap = '8px';
        imagesDiv.style.justifyContent = 'flex-start';
        note.images.forEach((img, idx) => {
            const imgWrap = document.createElement('div');
            imgWrap.className = 'note-image-wrap';
            imgWrap.style.position = 'relative';
            imgWrap.style.display = 'inline-block';
            imgWrap.style.margin = '4px auto';
            imgWrap.style.textAlign = 'center';
            imgWrap.style.width = (img.w||120) + 'px';
            imgWrap.style.height = (img.h||80) + 'px';
            imgWrap.style.overflow = 'hidden';
            // Картинка
            const image = document.createElement('img');
            image.src = img.src;
            image.style.maxWidth = '100%';
            image.style.maxHeight = '100%';
            image.style.width = (img.w||120) + 'px';
            image.style.height = (img.h||80) + 'px';
            image.style.display = 'block';
            image.style.borderRadius = '4px';
            image.style.background = '#eee';
            image.style.transition = 'transform 0.3s, opacity 0.3s';
            image.style.cursor = 'pointer';
            image.onclick = (e) => {
                e.stopPropagation();
                this.showImageModal(img.src);
            };
            // Кнопка удаления SVG
            const del = document.createElement('button');
            del.className = 'note-image-delete';
            del.title = 'Удалить фото';
            del.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#f44336" stroke-width="1.5"/><path d="M7 7l6 6M13 7l-6 6" stroke="#f44336" stroke-width="1.5"/></svg>`;
            del.style.position = 'absolute';
            del.style.top = '2px';
            del.style.right = '2px';
            del.style.background = 'rgba(255,255,255,0.8)';
            del.style.border = 'none';
            del.style.borderRadius = '50%';
            del.style.cursor = 'pointer';
            del.style.width = '24px';
            del.style.height = '24px';
            del.style.display = 'flex';
            del.style.alignItems = 'center';
            del.style.justifyContent = 'center';
            del.style.transition = 'background 0.2s';
            del.onclick = (e) => {
                e.stopPropagation();
                imgWrap.classList.add('removing');
                setTimeout(() => {
                  note.images.splice(idx, 1);
                  this.render();
                }, 250);
            };
            // Resize-уголок
            const resizer = document.createElement('div');
            resizer.className = 'note-image-resizer';
            resizer.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 14L14 2M10 14h4v-4" stroke="#2196F3" stroke-width="1.5" fill="none"/></svg>`;
            resizer.style.position = 'absolute';
            resizer.style.right = '0';
            resizer.style.bottom = '0';
            resizer.style.width = '16px';
            resizer.style.height = '16px';
            resizer.style.cursor = 'nwse-resize';
            resizer.style.background = 'rgba(0,0,0,0.05)';
            let resizing = false;
            resizer.onmousedown = (e) => {
                e.stopPropagation();
                resizing = true;
                let startX = e.clientX, startY = e.clientY;
                let startW = img.w||120, startH = img.h||80;
                document.onmousemove = (ev) => {
                    if (!resizing) return;
                    let dw = ev.clientX - startX;
                    let dh = ev.clientY - startY;
                    img.w = Math.max(40, Math.min(500, startW + dw));
                    img.h = Math.max(30, Math.min(400, startH + dh));
                    image.style.width = img.w + 'px';
                    image.style.height = img.h + 'px';
                    imgWrap.style.width = img.w + 'px';
                    imgWrap.style.height = img.h + 'px';
                };
                document.onmouseup = () => {
                    resizing = false;
                    document.onmousemove = null;
                    document.onmouseup = null;
                };
            };
            imgWrap.appendChild(image);
            imgWrap.appendChild(del);
            imgWrap.appendChild(resizer);
            imagesDiv.appendChild(imgWrap);
            setTimeout(() => { imgWrap.classList.add('shown'); }, 10);
        });
        // Аудио внутри заметки
        const audiosDiv = noteElement.querySelector('.note-audios');
        audiosDiv.style.display = 'flex';
        audiosDiv.style.flexDirection = 'column';
        audiosDiv.style.gap = '8px';
        note.audios.forEach((audio, idx) => {
            const audioWrap = document.createElement('div');
            audioWrap.className = 'note-audio-wrap';
            audioWrap.style.position = 'relative';
            audioWrap.style.display = 'flex';
            audioWrap.style.alignItems = 'center';
            audioWrap.style.gap = '8px';
            // Плеер
            const audioElem = document.createElement('audio');
            audioElem.controls = true;
            audioElem.src = audio.src;
            audioElem.style.maxWidth = '140px';
            audioElem.style.minWidth = '80px';
            audioElem.style.width = '100%';
            audioElem.style.boxSizing = 'border-box';
            // Название файла
            const nameSpan = document.createElement('span');
            nameSpan.textContent = audio.name || 'audio';
            nameSpan.style.fontSize = '0.85em';
            nameSpan.style.color = '#555';
            // Кнопка удаления
            const del = document.createElement('button');
            del.className = 'note-audio-delete';
            del.title = 'Удалить аудио';
            del.innerHTML = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#f44336" stroke-width="1.5"/><path d="M7 7l6 6M13 7l-6 6" stroke="#f44336" stroke-width="1.5"/></svg>`;
            del.style.background = 'none';
            del.style.border = 'none';
            del.style.cursor = 'pointer';
            del.style.display = 'flex';
            del.style.alignItems = 'center';
            del.style.justifyContent = 'center';
            del.onclick = (e) => {
                e.stopPropagation();
                note.audios.splice(idx, 1);
                this.render();
            };
            audioWrap.appendChild(audioElem);
            audioWrap.appendChild(nameSpan);
            audioWrap.appendChild(del);
            audiosDiv.appendChild(audioWrap);
        });
        // --- Кнопка добавления фото ---
        const photoBtn = noteElement.querySelector('.note-photo');
        photoBtn.onclick = (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (ev) => {
                const file = input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev2) => {
                    note.images.push({src: ev2.target.result, w: 120, h: 80});
                    this.render();
                };
                reader.readAsDataURL(file);
            };
            input.click();
        };
        // --- Кнопка добавления аудио ---
        const audioBtn = noteElement.querySelector('.note-audio');
        audioBtn.onclick = (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'audio/*';
            input.onchange = (ev) => {
                const file = input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev2) => {
                    note.audios.push({src: ev2.target.result, name: file.name});
                    this.render();
                };
                reader.readAsDataURL(file);
            };
            input.click();
        };
        this.workspace.appendChild(noteElement);
        if (note.important) noteElement.classList.add('important');
        else noteElement.classList.remove('important');
    }
    
    ensureNoteHeight(note, noteElement, textarea) {
        // Высота = header + title + textarea + images + audios + отступы
        const header = noteElement.querySelector('.note-header');
        const title = noteElement.querySelector('.note-title');
        const images = noteElement.querySelector('.note-images');
        const audios = noteElement.querySelector('.note-audios');
        let h = 0;
        if (header) h += header.offsetHeight;
        if (title) h += title.offsetHeight;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = (textarea.scrollHeight) + 'px';
            h += textarea.scrollHeight;
        }
        if (images) h += images.offsetHeight;
        if (audios) h += audios.offsetHeight;
        h += 24; // внутренние отступы
        note.height = h;
        noteElement.style.height = h + 'px';
        note.width = noteElement.offsetWidth;
    }
    
    makeNoteDraggable(noteElement, note) {
        const header = noteElement.querySelector('.note-header');
        header.onmousedown = (e) => {
            if (e.target.classList.contains('note-close')) return;
            if (e.ctrlKey) return;
            this.isDragging = true;
            this.dragNote = note;
            this.dragOffset.x = e.clientX - note.x;
            this.dragOffset.y = e.clientY - note.y;
            document.onmousemove = (ev) => {
                if (!this.isDragging) return;
                note.x = (ev.clientX - this.dragOffset.x);
                note.y = (ev.clientY - this.dragOffset.y);
                // Не трогаем note.height!
                this.render();
            };
            document.onmouseup = () => {
                this.isDragging = false;
                noteElement.style.cursor = 'move';
                document.onmousemove = null;
                document.onmouseup = null;
                this.notifyProjectChanged();
            };
        };
    }
    
    selectNote(note) {
        this.selectSingleNote(note);
    }
    
    deleteNote(noteId) {
        const noteIndex = this.notes.findIndex(n => n.id === noteId);
        if (noteIndex === -1) return;
        // Анимация удаления
        const noteElement = document.getElementById(`note-${noteId}`);
        if (noteElement) {
            noteElement.classList.add('note-removing');
            setTimeout(() => {
                // Удаляем заметку из массива
                this.notes.splice(noteIndex, 1);
                // Удаляем связанные соединения
                this.connections = this.connections.filter(conn => 
                    conn.fromNoteId !== noteId && conn.toNoteId !== noteId
                );
                this.render();
                // Удаляем из выделенных заметок
                this.selectedNotes = this.selectedNotes.filter(note => note.id !== noteId);
                this.updateConnectButton();
                this.notifyProjectChanged();
            }, 300);
        } else {
            // Если DOM-элемент не найден, просто удаляем
            this.notes.splice(noteIndex, 1);
            this.connections = this.connections.filter(conn => 
                conn.fromNoteId !== noteId && conn.toNoteId !== noteId
            );
            this.render();
            this.selectedNotes = this.selectedNotes.filter(note => note.id !== noteId);
            this.updateConnectButton();
            this.notifyProjectChanged();
        }
    }
    
    createConnection(fromNoteId, toNoteId) {
        const connection = {
            id: Date.now(),
            fromNoteId: fromNoteId,
            toNoteId: toNoteId,
            anim: true // флаг для анимации
        };
        this.connections.push(connection);
        this.render();
        this.notifyProjectChanged();
        return connection;
    }
    
    updateConnections() {
        // Удаляем старые соединения
        const oldConnections = document.querySelectorAll('.connection');
        oldConnections.forEach(conn => conn.remove());
        
        // Создаем новые соединения
        this.connections.forEach(connection => {
            this.renderConnection(connection);
        });
    }
    
    renderConnection(connection) {
        const fromNote = this.notes.find(n => n.id === connection.fromNoteId);
        const toNote = this.notes.find(n => n.id === connection.toNoteId);
        if (!fromNote || !toNote) return;
        const fromX = fromNote.x + fromNote.width / 2;
        const fromY = fromNote.y + fromNote.height / 2;
        const toX = toNote.x + toNote.width / 2;
        const toY = toNote.y + toNote.height / 2;
        const connectionElement = document.createElement('div');
        connectionElement.className = 'connection';
        if (connection.anim) {
            connectionElement.classList.add('connection-anim');
            setTimeout(() => { delete connection.anim; connectionElement.classList.remove('connection-anim'); }, 300);
        }
        if (connection.removing) {
            connectionElement.classList.add('connection-removing');
        }
        connectionElement.style.position = 'absolute';
        connectionElement.style.top = '0';
        connectionElement.style.left = '0';
        connectionElement.style.width = '100%';
        connectionElement.style.height = '100%';
        connectionElement.style.pointerEvents = 'none';
        connectionElement.style.zIndex = '-1';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', fromX);
        line.setAttribute('y1', fromY);
        line.setAttribute('x2', toX);
        line.setAttribute('y2', toY);
        line.setAttribute('stroke', '#2196F3');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('fill', 'none');
        if (document.body.classList.contains('dark-theme')) {
            line.setAttribute('stroke', '#64B5F6');
        }
        svg.appendChild(line);
        connectionElement.appendChild(svg);
        this.workspace.appendChild(connectionElement);
    }
    
    handleWorkspaceClick(e) {
        if (e.target.id === 'workspace') {
            this.clearSelection();
        }
    }
    
    handleMouseDown(e) {
        // Проверяем, что клик был по заметке
        const noteElement = e.target.closest('.note');
        if (!noteElement) return;
        
        const noteId = parseInt(noteElement.id.replace('note-', ''));
        const note = this.notes.find(n => n.id === noteId);
        if (!note) return;
        
        // Если зажат Ctrl, добавляем к выделению
        if (e.ctrlKey) {
            e.preventDefault();
            this.toggleNoteSelection(note);
        } else {
            // Обычный клик - выделяем только эту заметку
            this.selectSingleNote(note);
        }
    }
    
    toggleNoteSelection(note) {
        const index = this.selectedNotes.findIndex(n => n.id === note.id);
        const noteElement = document.getElementById(`note-${note.id}`);
        
        if (index === -1) {
            // Добавляем к выделению
            this.selectedNotes.push(note);
            noteElement.classList.add('selected');
        } else {
            // Убираем из выделения
            this.selectedNotes.splice(index, 1);
            noteElement.classList.remove('selected');
        }
        
        this.updateConnectButton();
    }
    
    selectSingleNote(note) {
        this.clearSelection();
        this.selectedNotes = [note];
        const noteElement = document.getElementById(`note-${note.id}`);
        if (noteElement) {
            noteElement.classList.add('selected');
        }
        this.updateConnectButton();
    }
    
    clearSelection() {
        this.selectedNotes = [];
        document.querySelectorAll('.note').forEach(note => {
            note.classList.remove('selected');
        });
        this.updateConnectButton();
    }
    
    selectAllNotes() {
        this.selectedNotes = [...this.notes];
        document.querySelectorAll('.note').forEach(note => {
            note.classList.add('selected');
        });
        this.updateConnectButton();
    }
    
    updateConnectButton() {
        const connectBtn = document.getElementById('connectNotes');
        connectBtn.disabled = this.selectedNotes.length !== 2;
    }
    
    connectSelectedNotes() {
        if (this.selectedNotes.length < 2) return;
        
        let connectionsCreated = 0;
        
        // Создаем связи между всеми выбранными заметками
        for (let i = 0; i < this.selectedNotes.length - 1; i++) {
            for (let j = i + 1; j < this.selectedNotes.length; j++) {
                const fromNote = this.selectedNotes[i];
                const toNote = this.selectedNotes[j];
                
                // Проверяем, нет ли уже такой связи
                const existingConnection = this.connections.find(conn => 
                    (conn.fromNoteId === fromNote.id && conn.toNoteId === toNote.id) ||
                    (conn.fromNoteId === toNote.id && conn.toNoteId === fromNote.id)
                );
                
                if (!existingConnection) {
                    this.createConnection(fromNote.id, toNote.id);
                    connectionsCreated++;
                }
            }
        }
        
        // Показываем уведомление
        this.showNotification(`Создано ${connectionsCreated} новых связей между заметками`);
        
        // Отладочная информация
        console.log('Всего связей:', this.connections.length);
        console.log('Связи:', this.connections);
    }
    
    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    
    handleWorkspaceContextMenu(e) {
        e.preventDefault();
        
        if (e.target.id === 'workspace') {
            this.showContextMenu(e.clientX, e.clientY, [
                { text: 'Создать заметку', action: () => this.createNote(e.clientX, e.clientY) }
            ]);
        }
    }
    
    showContextMenu(x, y, items) {
        // Удаляем старое меню
        const oldMenu = document.querySelector('.context-menu');
        if (oldMenu) oldMenu.remove();
        
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        
        items.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            menuItem.textContent = item.text;
            menuItem.addEventListener('click', () => {
                item.action();
                menu.remove();
            });
            menu.appendChild(menuItem);
        });
        
        document.body.appendChild(menu);
    }
    
    handleGlobalClick(e) {
        // Закрываем контекстное меню при клике вне его
        if (!e.target.closest('.context-menu')) {
            const menu = document.querySelector('.context-menu');
            if (menu) menu.remove();
        }
    }
    
    handleKeydown(e) {
        if (e.key === 'Delete' && this.selectedNotes.length > 0) {
            this.selectedNotes.forEach(note => {
                this.deleteNote(note.id);
            });
            this.selectedNotes = [];
            this.render();
        }
        // Ctrl+A для выделения всех заметок
        if (e.ctrlKey && e.code === 'KeyA') {
            e.preventDefault();
            this.selectAllNotes();
        }
        // Ctrl+X — создать связь между двумя выделенными заметками
        if (e.ctrlKey && e.code === 'KeyX') {
            if (this.selectedNotes.length === 2) {
                const [n1, n2] = this.selectedNotes;
                const exists = this.connections.some(conn =>
                    (conn.fromNoteId === n1.id && conn.toNoteId === n2.id) ||
                    (conn.fromNoteId === n2.id && conn.toNoteId === n1.id)
                );
                if (!exists) {
                    this.createConnection(n1.id, n2.id);
                    this.showNotification('Связь создана');
                } else {
                    this.showNotification('Связь уже существует');
                }
            }
        }
        // Ctrl+Z — удалить связь между двумя выделенными заметками
        if (e.ctrlKey && e.code === 'KeyZ') {
            if (this.selectedNotes.length === 2) {
                const [n1, n2] = this.selectedNotes;
                const idx = this.connections.findIndex(conn =>
                    (conn.fromNoteId === n1.id && conn.toNoteId === n2.id) ||
                    (conn.fromNoteId === n2.id && conn.toNoteId === n1.id)
                );
                if (idx !== -1) {
                    this.removeConnectionAnimated(idx);
                    this.showNotification('Связь удалена');
                } else {
                    this.showNotification('Связи между этими заметками нет');
                }
            }
        }
        // Enter — создать заметку в позиции курсора (если не в textarea)
        if (e.key === 'Enter' && document.activeElement.tagName !== 'TEXTAREA') {
            this.createNote(this.lastMousePos.x, this.lastMousePos.y);
        }
    }
    
    toggleTheme() {
        this.isDarkTheme = !this.isDarkTheme;
        document.body.classList.toggle('dark-theme', this.isDarkTheme);
        localStorage.setItem('scenarist-theme', this.isDarkTheme ? 'dark' : 'light');
        
        // Обновляем связи при изменении темы
        this.updateConnections();
    }
    
    loadTheme() {
        const savedTheme = localStorage.getItem('scenarist-theme');
        this.isDarkTheme = savedTheme === 'dark';
        document.body.classList.toggle('dark-theme', this.isDarkTheme);
    }
    
    saveScenario(onSaved) {
        const scenario = {
            notes: this.notes,
            connections: this.connections
        };
        // сериализация: base64(JSON) + сигнатура
        const json = JSON.stringify(scenario);
        const base64 = btoa(unescape(encodeURIComponent(json)));
        const data = 'SCENv1:' + base64;
        ipcRenderer.send('save-file', data);
        this.notifyProjectChanged();
        // onSaved будет вызван после file-saved
        this._onSavedCallback = onSaved;
    }
    
    loadScenario() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.scen';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target.result;
                if (!text.startsWith('SCENv1:')) {
                    alert('Неверный формат файла!');
                    return;
                }
                const base64 = text.slice(7);
                const json = decodeURIComponent(escape(atob(base64)));
                const scenario = JSON.parse(json);
                this.loadScenarioData(scenario);
            };
            reader.readAsText(file);
        };
        input.click();
    }
    
    loadScenarioData(scenario) {
        // Очищаем текущий сценарий
        this.notes = [];
        this.connections = [];
        this.selectedNotes = [];
        this.nextNoteId = 1;
        
        // Очищаем DOM
        this.workspace.innerHTML = '';
        
        // Загружаем заметки
        if (scenario.notes) {
            scenario.notes.forEach(note => {
                this.notes.push(note);
                this.nextNoteId = Math.max(this.nextNoteId, note.id + 1);
            });
        }
        
        // Загружаем соединения
        if (scenario.connections) {
            this.connections = scenario.connections;
        }
        
        // Восстанавливаем тему из localStorage (если была сохранена)
        this.loadTheme();
        
        this.updateConnectButton();
        this.render();
    }
    
    createNote(x = 200, y = 200) {
        const note = {
            id: this.nextNoteId++,
            x: x,
            y: y,
            width: 200,
            height: 150,
            content: '',
            title: 'Новая заметка',
            images: [],
            audios: [],
            important: false
        };
        this.notes.push(note);
        this.render();
        this.notifyProjectChanged();
        return note; // Возвращаем заметку для использования в sample
    }
    
    createSampleNotes() {
        // Создаем несколько примеров заметок
        const note1 = this.createNote(50, 50);
        note1.title = 'Начало истории';
        note1.content = 'Главный герой просыпается в незнакомом месте...';
        const note2 = this.createNote(300, 50);
        note2.title = 'Первая встреча';
        note2.content = 'Герой встречает загадочного персонажа...';
        const note3 = this.createNote(150, 200);
        note3.title = 'Ключевое решение';
        note3.content = 'Герой должен сделать важный выбор...';
        // Создаем связи между заметками
        this.createConnection(note1.id, note2.id);
        this.createConnection(note2.id, note3.id);
    }
    
    // Модальное окно для просмотра фото
    showImageModal(src) {
        // Удаляем старое модальное окно, если есть
        let oldModal = document.getElementById('image-modal');
        if (oldModal) oldModal.remove();
        // Затемнение
        const overlay = document.createElement('div');
        overlay.id = 'image-modal';
        overlay.style.position = 'fixed';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.background = 'rgba(0,0,0,0.7)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999';
        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
        };
        // Картинка
        const bigImg = document.createElement('img');
        bigImg.src = src;
        bigImg.style.maxWidth = '90vw';
        bigImg.style.maxHeight = '90vh';
        bigImg.style.borderRadius = '10px';
        bigImg.style.boxShadow = '0 4px 32px rgba(0,0,0,0.5)';
        bigImg.style.background = '#fff';
        bigImg.style.display = 'block';
        // Кнопка закрытия
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = `<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" stroke="#fff" stroke-width="2.5" fill="rgba(0,0,0,0.3)"/><path d="M10 10l12 12M22 10l-12 12" stroke="#fff" stroke-width="2.5"/></svg>`;
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '32px';
        closeBtn.style.right = '32px';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.zIndex = '10000';
        closeBtn.onclick = () => overlay.remove();
        overlay.appendChild(bigImg);
        overlay.appendChild(closeBtn);
        document.body.appendChild(overlay);
    }
    
    notifyProjectChanged() {
        const scenario = {
            notes: this.notes,
            connections: this.connections
        };
        // сериализация: base64(JSON) + сигнатура
        const json = JSON.stringify(scenario);
        const base64 = btoa(unescape(encodeURIComponent(json)));
        const data = 'SCENv1:' + base64;
        console.log('[AUTOSAVE] autosave.scen будет обновлён, заметок:', this.notes.length, 'связей:', this.connections.length);
        ipcRenderer.send('project-changed', data);
    }
    
    // Для удаления связи с анимацией
    removeConnectionAnimated(idx) {
        const conn = this.connections[idx];
        if (!conn) return;
        // Помечаем для анимации
        conn.removing = true;
        this.render();
        setTimeout(() => {
            this.connections.splice(idx, 1);
            this.render();
        }, 300);
    }
}

// Инициализация приложения
const app = new ScenaristApp();

// Обработка запроса на сохранение перед выходом:
ipcRenderer.on('request-save-before-exit', () => {
    console.log('[EXIT] Запрошено сохранение перед выходом');
    window.app.saveScenario(() => {
        console.log('[EXIT] Сохранено, отправляю save-and-exit');
        ipcRenderer.send('project-saved');
        ipcRenderer.send('save-and-exit');
    });
}); 