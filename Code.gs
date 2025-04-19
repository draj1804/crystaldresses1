function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Sheets Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getCurrentUser() {
  return Session.getActiveUser().getEmail();
}

function getUserRights() {
  try {
    const userEmail = getCurrentUser().toLowerCase();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Users');
    
    if (!sheet) return { error: "Users sheet not found" };
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const usernameIndex = headers.indexOf('Username');
    const rightsIndex = headers.indexOf('Rights');
    
    if (usernameIndex === -1 || rightsIndex === -1) {
      return { error: "Required columns not found in Users sheet" };
    }
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][usernameIndex].toString().toLowerCase() === userEmail) {
        return {
          email: userEmail,
          rights: data[i][rightsIndex].toString().split(',').map(r => r.trim()),
          status: 'success'
        };
      }
    }
    
    return { error: "User not found in Users sheet" };
  } catch (e) {
    return { error: e.message };
  }
}

function getAuthorizedSheets() {
  const userRights = getUserRights();
  if (userRights.error) return { error: userRights.error };
  
  const allSheets = {
    'Dashboard': ['Dashboard', 'All'],
    'Payments - Data': ['Payment', 'All'],
    'Payments - Summary': ['Payment', 'All'],
    'Payments - Followup': ['Payment', 'All'],
    'Sales - Daily Sales': ['Sale', 'All'],
    'PC - Inventory': ['PC', 'All'],
    'PC - Orders': ['PC', 'All'],
    'Delegation Task': ['PC','All'],
    'Sales Dashboard': ['PC','All']
  };
  
  const authorizedSheets = [];
  
  Object.keys(allSheets).forEach(sheetName => {
    const requiredRights = allSheets[sheetName];
    if (requiredRights.some(right => userRights.rights.includes(right))) {
      authorizedSheets.push(sheetName);
    }
  });
  
  return {
    email: userRights.email,
    rights: userRights.rights,
    sheets: authorizedSheets,
    status: 'success'
  };
}

function validateSheetAccess(sheetName) {
  const auth = getAuthorizedSheets();
  if (auth.error) return false;
  return auth.sheets.includes(sheetName);
}

function getDashboardData() {
  try {
    if (!validateSheetAccess('Dashboard')) {
      return { error: "Access denied to Dashboard" };
    }
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Dashboard');
    const data = sheet.getDataRange().getValues();
    
    if (data.length < 2) {
      return { error: "Dashboard data is empty" };
    }
    
    const statusData = {};
    const chartData = [];
    
    for (let i = 1; i < data.length; i++) {
      const status = data[i][0]?.toString() || '';
      const count = Number(data[i][1]) || 0;
      
      if (status) {
        statusData[status] = count;
        chartData.push([status, count]);
      }
    }
    
    return {
      statusData: statusData,
      chartData: chartData,
      total: Object.values(statusData).reduce((a, b) => a + b, 0),
      status: 'success'
    };
  } catch (e) {
    return { error: e.message };
  }
}

function getSheetData(sheetName, page = 1, pageSize = 500) {
  try {
    if (!validateSheetAccess(sheetName)) {
      return { error: "Access denied to this sheet" };
    }
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { error: "Sheet not found" };
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    if (lastRow <= 1 || lastCol < 1) {
      return { 
        headers: [], 
        data: [], 
        totalRows: 0,
        page: page,
        pageSize: pageSize
      };
    }
    
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const startRow = Math.max(2, (page - 1) * pageSize + 2);
    const numRows = Math.min(pageSize, lastRow - startRow + 1);
    
    const range = sheet.getRange(startRow, 1, numRows, lastCol);
    const values = range.getValues();
    const formats = range.getNumberFormats();
    
    const processedData = values.map((row, rowIndex) => {
      return row.map((cell, colIndex) => {
        const format = formats[rowIndex][colIndex];
        const isDate = format.includes('m/') || format.includes('d/') || format.includes('yyyy');
        
        if (cell instanceof Date && isDate) {
          return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
        return cell !== null ? cell : '';
      });
    });
    
    return {
      headers: headers,
      data: processedData,
      totalRows: lastRow - 1,
      page: page,
      pageSize: pageSize
    };
  } catch (e) {
    return { error: e.message };
  }
}

function getColumnValues(sheetName, columnIndex) {
  try {
    if (!validateSheetAccess(sheetName)) return [];
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];
    
    const colData = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1).getValues().flat();
    return [...new Set(colData)].filter(item => item !== '');
  } catch (e) {
    return [];
  }
}

function getFilteredData(sheetName, filters, page = 1, pageSize = 500) {
  try {
    if (!validateSheetAccess(sheetName)) {
      return { error: "Access denied to this sheet" };
    }
    
    const allData = getSheetData(sheetName, 1, 10000);
    if (allData.error) return allData;
    
    let filteredData = allData.data;
    const headers = allData.headers;
    
    Object.entries(filters).forEach(([columnName, value]) => {
      if (value && value !== 'ALL') {
        const colIndex = headers.indexOf(columnName);
        if (colIndex >= 0) {
          filteredData = filteredData.filter(row => row[colIndex] == value);
        }
      }
    });
    
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const paginatedData = filteredData.slice(startIdx, endIdx);
    
    return {
      headers: headers,
      data: paginatedData,
      totalRows: filteredData.length,
      page: page,
      pageSize: pageSize
    };
  } catch (e) {
    return { error: e.message };
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Add this function to get filter configuration for each sheet
function getFilterConfig(sheetName) {
  const config = {
    'Payments - Data': {
      filters: ['Customer Code', 'Customer Name', 'Amount Range'],
      specialOptions: {
        'Amount Range': ['0-100', '100-500', '500-1000', '1000+']
      }
    },
    'Sales - Daily Sales': {
      filters: ['Date Range', 'Product Category', 'Sales Rep'],
      dateRange: true
    },
    'Dashboard': {
      filters: [], // No filters for dashboard
    },
    'Delegation Task':{
      filters: ['Assigned To', 'Assigned By', 'Master Task ID']
    }
    // Add configurations for other sheets
  };
  
  return config[sheetName] || {
    filters: 'default', // Will use all columns as filters
    dateRange: false
  };
}
function getReportEmbeds() {
  return {
    'Sales Dashboard': {
      embedUrl: 'https://lookerstudio.google.com/embed/reporting/41b67599-bba0-4537-8ca0-8201030fa77c/page/kMXZE',
      width: '100%',
      height: '600px'
    },
    'Marketing Performance': {
      embedUrl: 'https://lookerstudio.google.com/embed/reporting/ANOTHER_REPORT_ID/page/PAGE_ID',
      width: '100%',
      height: '800px'
    }
    // Add more reports as needed
  };
}
