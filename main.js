const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let isSaved = true;
let lastProjectData = null;
const autosavePath = path.join(app.getPath('userData'), 'autosave.scen');

// Обработка открытия файла через двойной клик
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      mainWindow.webContents.send('load-scenario-file', data);
    } catch (error) {
      dialog.showErrorBox('Ошибка', 'Не удалось открыть файл: ' + error.message);
    }
  }
});

// Регистрируем обработчик файлов
if (process.platform === 'darwin') {
  app.setAsDefaultProtocolClient('scen');
}

function createWindow(fileToOpen = null) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'Сценарист - Приложение для создания сценариев'
  });

  mainWindow.loadFile('index.html');

  // Если файл передан через аргументы командной строки
  if (fileToOpen) {
    setTimeout(() => {
      try {
        const data = fs.readFileSync(fileToOpen, 'utf8');
        mainWindow.webContents.send('load-scenario-file', data);
      } catch (error) {
        dialog.showErrorBox('Ошибка', 'Не удалось открыть файл: ' + error.message);
        showStartupDialog();
      }
    }, 500);
  } else {
    // Диалог выбора при запуске (без звука)
    setTimeout(() => {
      showStartupDialog();
    }, 500);
  }

  // Открываем DevTools в режиме разработки
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Подтверждение закрытия, если есть несохранённые изменения
  mainWindow.on('close', (e) => {
    if (!isSaved) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['Сохранить', 'Не сохранять', 'Отмена'],
        defaultId: 0,
        cancelId: 2,
        message: 'Сохранить проект перед выходом?',
        noLink: true // Убираем звук Windows
      });
      if (choice === 0) {
        mainWindow.webContents.send('request-save-before-exit');
        e.preventDefault();
      } else if (choice === 2) {
        e.preventDefault();
      }
      // если 1 — закрываем без сохранения
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showStartupDialog() {
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    buttons: ['Открыть существующий проект', 'Начать новый проект'],
    defaultId: 0,
    cancelId: 1,
    message: 'Что вы хотите сделать?',
    detail: 'Выберите действие для начала работы',
    noLink: true // Убираем звук Windows
  });
  
  if (choice === 0) {
    // Открыть существующий проект
    const result = dialog.showOpenDialogSync(mainWindow, {
      properties: ['openFile'],
      title: 'Открыть сценарий',
      defaultPath: '',
      filters: [{ name: 'Сценарии', extensions: ['scen'] }],
      noLink: true // Убираем звук Windows
    });
    
    if (result && result.length > 0) {
      const filePath = result[0];
      try {
        const data = fs.readFileSync(filePath, 'utf8');
        mainWindow.webContents.send('load-scenario-file', data);
      } catch (error) {
        dialog.showErrorBox('Ошибка', 'Не удалось открыть файл: ' + error.message);
      }
    }
  } else {
    // Начать новый проект
    mainWindow.webContents.send('start-new-project');
  }
}

app.whenReady().then(() => {
  // Проверяем, есть ли файл в аргументах командной строки
  const fileToOpen = process.argv.find(arg => arg.endsWith('.scen'));
  createWindow(fileToOpen);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('project-changed', (event, data) => {
  isSaved = false;
  lastProjectData = data;
  fs.writeFileSync(autosavePath, data, 'utf8');
});
ipcMain.on('project-saved', () => {
  isSaved = true;
  if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath);
});
ipcMain.on('save-and-exit', (event, data) => {
  isSaved = true;
  if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath);
  if (mainWindow) mainWindow.destroy();
});

ipcMain.on('save-file', async (event, data) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Сохранить сценарий',
    defaultPath: 'сценарий.scen',
    filters: [{ name: 'Сценарии', extensions: ['scen'] }]
  });
  if (!canceled && filePath) {
    fs.writeFileSync(filePath, data, 'utf8');
    event.sender.send('file-saved', filePath);
  } else {
    event.sender.send('file-saved', null);
  }
}); 