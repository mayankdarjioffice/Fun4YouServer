import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, serverTimestamp, deleteField } from 'firebase/firestore';
// NEW: QR Code Implementation - Import QRCode component
import { QRCodeCanvas } from "qrcode.react";
// NEW: QR Code Implementation - Import uuid for unique tokens
import { v4 as uuidv4 } from 'uuid';
import html2canvas from 'html2canvas';

// Define the pricing for gaming options (hourly rates)
const GAMING_HOURLY_PRICES = {
  PC: 90,
  PS: 120,
  'PS(2P)': 110,         // PS for 2 Players
  'PS(3P)': 100,         // NEW: PS for 3 Players, consumes 3 slots
  'PS(4P)': 100,         // NEW: PS for 4 Players, consumes 4 slots
  'Racing Cockpit': 150, // UPDATED: Racing Cockpit price
  'Custom Price': 0,     // NEW: Custom Price option (hourly rate will be manually entered)
};

// Fixed prices for standard beverages (UPDATED AND REORDERED BY PRICE)
const FIXED_BEVERAGE_PRICES = {
  'Water (Small)': 10,
  'Water (Large)': 20, // New entry for Water Large
  Sprite: 20,
  'Coca Cola (200ml)': 20, // Distinct entry for 20rs
  'Thumps Up': 20,
  Fanta: 20,
  Mojito: 20,
  Kurkure: 30,
  'Diet Coke': 40,
  'Coca Cola (Large)': 40, // Distinct entry for 40rs
  'Too Yum': 50,
  Cheetos: 50,
  Lays: 50,
  'Coconut water': 55,
  Nachos: 90, // UPDATED: Nachos price
  Redbull: 125, // UPDATED: Redbull price
  Monster: 125,
};

// Helper function to sort the FIXED_BEVERAGE_PRICES by value (price)
const sortBeveragePrices = (prices) => {
  return Object.fromEntries(
    Object.entries(prices).sort(([, priceA], [, priceB]) => priceA - priceB)
  );
};

// Sorted prices will be used
const SORTED_FIXED_BEVERAGE_PRICES = sortBeveragePrices(FIXED_BEVERAGE_PRICES);


// Default secret password for initial setup
const DEFAULT_ADMIN_PASSWORD = "Fun4You@2025";

// Define duration options in minutes for the dropdown (updated per user request: hours only + custom hours)
const DURATION_OPTIONS = [
  { label: '1 hr', value: 60 },
  { label: '2 hr', value: 120 },
  { label: '3 hr', value: 180 },
  { label: '4 hr', value: 240 },
  { label: '5 hr', value: 300 },
  { label: '6 hr', value: 360 },
  { label: 'Custom (hours)', value: 'custom' }, // Custom option for hours
];

// Helper array for quantity options (1 to 20) for the new dropdown
const QUANTITY_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * Generates time slots for advance booking.
 * Slots are 1-hour duration, start from the current time onwards,
 * and extend to the end of the current calendar day (midnight 00:00 AM next day).
 * The last possible slot starting time is 11:00 PM (23:00) which ends at 12:00 AM (00:00).
 *
 * @param {Date} currentTime The current Date object to determine "now".
 * @returns {Array<string>} An array of formatted time slot strings (e.g., "10:00 AM - 11:00 AM").
 */
const generateTimeSlots = (forDateStr, currentTime) => {
  const slots = [];
  const now = currentTime;
  // Create a Date object for the start of the selected booking date (e.g., '2025-06-29T00:00:00')
  const forDate = new Date(forDateStr + 'T00:00:00');

  // Check if the selected date is the current calendar day
  const isToday = forDate.getFullYear() === now.getFullYear() &&
                  forDate.getMonth() === now.getMonth() &&
                  forDate.getDate() === now.getDate();
				  
  // Define the absolute end of the operational day (midnight of the *current* calendar day)
  // This means 00:00 AM of the next calendar day.
  const endOfOperationalDay = new Date(forDate.getTime());
  endOfOperationalDay.setDate(forDate.getDate() + 1);

  // Iterate to generate potential 30-minute interval start times
  // Operational hours are typically 10 AM onwards.
  // The latest possible 1-hour slot that ends *at or before* midnight (00:00 AM next day)
  // is a slot starting at 23:00 (11:00 PM).
  for (let h = 10; h <= 23; h++) { // Loop from 10 AM (hour 10) up to 11 PM (hour 23)
    for (let m = 0; m < 60; m += 30) {
      // If hour is 23 (11 PM), only allow minute 0 for a 1-hour slot ending at midnight.
      // A slot starting at 23:30 would end at 00:30 (past midnight), which we want to exclude.
      if (h === 23 && m > 0) {
        continue; // Skip 23:30 (11:30 PM) start time
      }

	  const slotStart = new Date(forDate.getFullYear(), forDate.getMonth(), forDate.getDate(), h, m, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000); // 1-hour duration

      // A slot is valid if:
      // 1. Its start time is greater than or equal to the current time (`now`).
      // 2. Its end time is less than or equal to midnight of the current operational day.
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000); // 5-minute buffer for "past" current time
      if ((isToday && slotStart.getTime() >= fiveMinutesAgo.getTime()) || (!isToday && slotStart.getTime() >= forDate.getTime())) {
        if (slotEnd.getTime() <= endOfOperationalDay.getTime()) {
          const formatTime = (date) => {
            let hours = date.getHours();
            const minutes = date.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // The hour '0' should be '12 AM'
            const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
            return `${hours}:${formattedMinutes} ${ampm}`;
          };
          slots.push(`${formatTime(slotStart)} - ${formatTime(slotEnd)}`);
        }
      }
    }
  }
  return slots;
};

  const Login = ({ auth, onLoginSuccess, onSignOut }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsAuthenticating(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      onLoginSuccess(); // Trigger a function in the parent to update the login state
    } catch (error) {
      setLoginError("Invalid email or password. Please try again.");
      console.error("Login failed:", error);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const isDarkMode = true; // Use a prop or define it here for consistent styling

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 transition-colors duration-500
      ${isDarkMode ? 'bg-gradient-to-br from-zinc-900 to-gray-950 text-gray-100' : 'bg-gray-100 text-gray-900'}`}>
      <div className={`w-full max-w-md p-8 rounded-2xl shadow-2xl transition-colors duration-500
        ${isDarkMode ? 'bg-zinc-800 border border-purple-800 shadow-xl shadow-purple-700/30' : 'bg-white border border-blue-200 shadow-xl shadow-blue-400/10'}`}>
        <div className="flex flex-col items-center justify-center">
		<img src="./images/logo.jpg" alt="Fun4You - The Console Corner" className="w-32 h-32 mb-4 rounded-full border shadow-l shadow-purple-600/20 transform transition-transform duration-300 ease-in-out hover:scale-105" />
		<h2 className={`text-3xl font-extrabold mb-6 text-center ${isDarkMode ? 'text-blue-400 text-glow-dark' : 'text-purple-600 text-glow'}`}>
          Fun4You Admin Login
        </h2>
		</div>
        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="email" className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring transition-colors duration-500
                ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900'}`}
            />
          </div>
          <div>
            <label htmlFor="password" className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
    Password
  </label>
  <div className="relative">
    <input
      // Toggle the input type based on the state
      type={showPassword ? "text" : "password"}
      id="password"
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      required
      className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring transition-colors duration-500
        ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900'}`}
    />
    <button
      type="button"
      onClick={() => setShowPassword(prev => !prev)}
      className={`absolute inset-y-0 right-0 pr-3 flex items-center text-sm leading-5
        ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
      title={showPassword ? "Hide password" : "Show password"}
    >
      {/* Eye icon for show/hide */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        {showPassword ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7A9.976 9.976 0 014.2 8.75m6.825 6.825a3 3 0 11-4.24-4.24m4.24 4.24L21 3"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        )}
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M2.458 12C3.732 7.086 7.523 4 12 4s8.268 3.086 9.542 8c-1.274 4.914-5.065 8-9.542 8s-8.268-3.086-9.542-8z"
        />
      </svg>
    </button>
	  </div>
          </div>
          {loginError && <p className="text-red-500 text-sm text-center">{loginError}</p>}
          <button
            type="submit"
            className="w-48 mx-auto px-4 py-2 flex gap-1 bg-gradient-to-r from-blue-600 to-purple-700 text-white font-extrabold rounded-full shadow-lg hover:from-blue-700 hover:to-purple-800 transform hover:scale-105 transition-all duration-300 ease-in-out justify-center"
            disabled={isAuthenticating}
          >
            {isAuthenticating ? 'Signing In...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
};

// Define station numbers
const PC_STATIONS = ['PC-1', 'PC-2', 'PC-3', 'PC-4'];
const PS_STATIONS = ['PS-1', 'PS-2', 'PS-3', 'PS-4'];
const ALL_STATIONS = [...PC_STATIONS, ...PS_STATIONS];

// NEW: PS Station Capacity
const PS_STATION_CAPACITY = 4; // Max players a PS station can handle

// NEW: Helper function to determine slots consumed by a gaming option
const getSlotsConsumed = (option) => {
  if (option === 'PS') return 4;
  if (option === 'PS(2P)') return 2;
  if (option === 'PS(3P)') return 1; // NEW: 3 slots for 3 players
  if (option === 'PS(4P)') return 1; // NEW: 4 slots for 4 players
  // For PC and Racing Cockpit, they effectively occupy the whole station for a single session.
  // For 'Custom Price', if it's selected for a PS station, assume it takes 1 slot by default
  // unless a separate player count is specified. For simplicity, let's say it takes 1 slot.
  if (option === 'PC' || option === 'Racing Cockpit' || option === 'Custom Price') return 1;
  return 0; // Default case, should not be reached for valid options
};

// Main App component
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [entries, setEntries] = useState([]);
  const [yesterdayEntries, setYesterdayEntries] = useState([]);
  const [todayEntries, setTodayEntries] = useState([]);
  const [beverages, setBeverages] = useState([]);
  const [newBeverageName, setNewBeverageName] = useState('');
  const [newBeveragePrice, setNewBeveragePrice] = useState('');

  // Form states for new entry
  const [name, setName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [gamingOption, setGamingOption] = useState('PC');
  const [stationNumber, setStationNumber] = useState(''); // NEW: Station Number state
  const [entryTime, setEntryTime] = useState('');
  const [duration, setDuration] = useState(DURATION_OPTIONS[0].value); // NEW: Duration in minutes or 'custom'
  const [customDuration, setCustomDuration] = useState(''); // NEW: State for custom duration input (in hours)

  const [selectedBeverages, setSelectedBeverages] = useState({}); 
  // NEW: Temporary states for beverage selection before adding to entry list
  const [tempSelectedBeverageId, setTempSelectedBeverageId] = useState('');
  const [tempSelectedBeverageQuantity, setTempSelectedBeverageQuantity] = useState(1); // Default to 1

  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [customGamingPrice, setCustomGamingPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State for editing existing entries (for modal)
  const [isEditing, setIsEditing] = useState(false);
  const [currentEditEntry, setCurrentEditEntry] = useState(null); 
  const [editGamingOption, setEditGamingOption] = useState('');
  const [editStationNumber, setEditStationNumber] = useState(''); // NEW: Edit Station Number state
  const [editDuration, setEditDuration] = useState(DURATION_OPTIONS[0].value); 
  const [editCustomDuration, setEditCustomDuration] = useState(''); 

  const [editSelectedBeverages, setEditSelectedBeverages] = useState({}); 
  // NEW: Temporary states for beverage selection in EDIT modal
  const [editTempSelectedBeverageId, setEditTempSelectedBeverageId] = useState('');
  const [editTempSelectedBeverageQuantity, setEditTempSelectedBeverageQuantity] = useState(1);

  const [applyDiscount, setApplyDiscount] = useState(false);
  const [editPaymentMethod, setEditPaymentMethod] = useState('');
  const [editCustomGamingPrice, setEditCustomGamingPrice] = useState('');
  const [editApplyDiscount, setEditApplyDiscount] = useState(false); // <-- ADD THIS LINE
  const [exporting, setExporting] = useState(false);

 // State for Advance Bookings (fetched from Firebase)
  const [advanceBookings, setAdvanceBookings] = useState([]);
  const [advanceBookingName, setAdvanceBookingName] = useState('');
  const [advanceBookingMobile, setAdvanceBookingMobile] = useState(''); 
  const [numPlayers, setNumPlayers] = useState(1);
  const [timeSlot, setTimeSlot] = useState(''); 
  const [advanceBookingGamingOption, setAdvanceBookingGamingOption] = useState('PC');

  // NEW: State for editing advance bookings
  const [isEditingAdvanceBooking, setIsEditingAdvanceBooking] = useState(false);
  const [currentEditAdvanceBooking, setCurrentEditAdvanceBooking] = useState(null);
  const [editAdvanceBookingName, setEditAdvanceBookingName] = useState('');
  const [editAdvanceBookingMobile, setEditAdvanceBookingMobile] = useState('');
  const [editNumPlayers, setEditNumPlayers] = useState(1);
  const [editAdvanceBookingGamingOption, setEditAdvanceBookingGamingOption] = useState(''); // <-- ADD THIS LINE
  const [editTimeSlot, setEditTimeSlot] = useState('');
  const [editSelectedBookingDate, setEditSelectedBookingDate] = useState(new Date().toISOString().slice(0, 10));


  // State to force re-render for real-time time calculations
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isDarkMode, setIsDarkMode] = useState(true);

  const serialCounterRef = useRef(null);
  const [serialCounter, setSerialCounter] = useState(0);


  // States for password-protected total collection
  const [todayTotalCollection, setTodayTotalCollection] = useState(0);
  const [adminPassword, setAdminPassword] = useState(''); 
  const [showTotalCollection, setShowTotalCollection] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Custom Modal states and functions (for general alerts/confirms)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [modalOnConfirm, setModalOnConfirm] = useState(null);
  const [modalType, setModalType] = useState('alert');

  // State for delete confirmation modal
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [deleteEntryId, setDeleteEntryId] = useState(null);
  const [deleteEntryName, setDeleteEntryName] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // New states for entry display filters
  const [showAllTodayEntries, setShowAllTodayEntries] = useState(true); 
  const [showCurrentActiveEntries, setShowCurrentActiveEntries] = useState(false); 

  // NEW: State for Time-Up Notification Pop-up
  const [showTimeUpNotification, setShowTimeUpNotification] = useState(false);
  const [notifiedEntry, setNotifiedEntry] = useState(null);
  const notificationTimerRef = useRef(null);
  const notifiedEntryIds = useRef(new Set());

  // NEW: State for password prompt for editing (when outTime + 30 mins has passed)
  const [showEditPasswordModal, setShowEditPasswordModal] = useState(false);
  const [editAttemptPassword, setEditAttemptPassword] = useState('');
  const [editAttemptPasswordError, setEditAttemptPasswordError] = useState('');
  const [entryToEditAfterPassword, setEntryToEditAfterPassword] = useState(null);

  // NEW: Tab state
  const [activeTab, setActiveTab] = useState('addEntry'); 

  // NEW: Admin password management states
  const [currentAdminPassword, setCurrentAdminPassword] = useState(DEFAULT_ADMIN_PASSWORD); 
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [oldPasswordInput, setNewOldPasswordInput] = useState(''); 
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');
  const adminPasswordDocRef = useRef(null);

  // NEW: Advance Booking Reminder states
  const [showAdvanceBookingReminder, setShowAdvanceBookingReminder] = useState(false);
  const [currentBookingReminder, setCurrentBookingReminder] = useState(null); 
  const bookingReminderTimerRef = useRef(null);
  const notifiedBookingIds = useRef(new Set()); 

  // Dynamic time slots for advance booking
  const [dynamicTimeSlots, setDynamicTimeSlots] = useState([]);
  const [dynamicTimeSlotsForEdit, setDynamicTimeSlotsForEdit] = useState([]);

  // NEW: State for the selected date for advance booking in the form
 const [selectedBookingDate, setSelectedBookingDate] = useState(new Date().toISOString().slice(0, 10)); //YYYY-MM-DD

  // NEW: State for the selected date to display advance bookings in the table
  const [selectedBookingDateForTable, setSelectedBookingDateForTable] = useState(new Date().toISOString().slice(0, 10)); //YYYY-MM-DD

  // NEW: State for beverage details modal
  const [showBeverageDetailsModal, setShowBeverageDetailsModal] = useState(false);
  const [beveragesForDetails, setBeveragesForDetails] = useState({}); 
  const [selectedEntryNameForBeverages, setSelectedEntryNameForBeverages] = useState('');

 // NEW: State to track if today's auto-export has occurred (persists across sessions if possible)
  const [lastAutoExportDate, setLastAutoExportDate] = useState(() => {
    return localStorage.getItem('lastAutoExportDate') || '';
  });

const handleSignOut = async () => {
  if (auth) {
    try {
      await signOut(auth);
      console.log("User signed out successfully.");
    } catch (error) {
      console.error("Error signing out:", error);
      // You could show a modal or a message to the user here
    }
  }
};

// NEW: State for Column Visibility Customization
  const [showColumnVisibilityModal, setShowColumnVisibilityModal] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState(() => {
    // Initialize from localStorage or default to all visible
    const savedVisibility = localStorage.getItem('columnVisibility');
    return savedVisibility ? JSON.parse(savedVisibility) : {
	  selectEntry: true,	
      serialNumber: true,
      date: true,
      name: true,
      mobileNumber: true,
      gamingOption: true,
	  stationNumber: true,
      entryTime: true,
      outTime: true,
      totalHours: true,
      remainingTime: true,
      hourlyRate: true,
      gamingPricing: true,
      beverages: true,
      beveragePricing: true,
      totalBill: true,
      paymentMethod: true,
      actions: true, // Actions should generally always be visible
    };
  });


  // NEW: Customer Management States
  const [customers, setCustomers] = useState([]);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerMobile, setNewCustomerMobile] = useState('');
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [currentEditCustomer, setCurrentEditCustomer] = useState(null);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerMobile, setEditCustomerMobile] = useState('');
  const [showDeleteCustomerConfirmModal, setShowDeleteCustomerConfirmModal] = useState(false);
  const [deleteCustomerId, setDeleteCustomerId] = useState(null);
  const [deleteCustomerName, setDeleteCustomerName] = useState('');
  const [customerSearchTerm, setCustomerSearchTerm] = useState(''); // For searching customers
  const [customerSuggestions, setCustomerSuggestions] = useState([]); // For auto-fill suggestions
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

  // NEW: Customer Management Password Protection states
  const [showCustomerManagementContent, setShowCustomerManagementContent] = useState(false);
  const [customerManagementPassword, setCustomerManagementPassword] = useState('');
  const [customerManagementPasswordError, setCustomerManagementPasswordError] = useState('');

  // NEW: State for selected entries for total billing
  const [selectedEntryIds, setSelectedEntryIds] = useState(new Set());
  const [totalSelectedBill, setTotalSelectedBill] = useState(0);
  const [totalBillKey, setTotalBillKey] = useState(0);

  const [showStationDetails, setShowStationDetails] = useState(false);

  // NEW: State for the Notification Bar
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [recentlyFinishedSessions, setRecentlyFinishedSessions] = useState([]);
  const [upcomingTodaysBookings, setUpcomingTodaysBookings] = useState([]);

// NEW: QR Code Implementation - States for QR code modal
const [showQrModal, setShowQrModal] = useState(false);
const [currentQrEntry, setCurrentQrEntry] = useState(null);
const [serverInfo, setServerInfo] = useState(null);
const [qrCodeData, setQrCodeData] = useState(''); // This will store ONLY the token
const [redemptionFullUrl, setRedemptionFullUrl] = useState(''); // This will store the full URL for sharing

// NEW: Notes feature states
const [showNotesModal, setShowNotesModal] = useState(false);
const [currentEntryForNotes, setCurrentEntryForNotes] = useState(null);
const [noteText, setNoteText] = useState('');
const [previousNoteInfo, setPreviousNoteInfo] = useState(null);

const downloadQrCode = () => {
const qrElement = document.getElementById('qrCodeElement');
if (!qrElement) return;

html2canvas(qrElement).then((canvas) => {
const link = document.createElement('a');
link.href = canvas.toDataURL("image/png");
link.download = `voucher-${qrCodeData}.png`;
link.click();
});
};

  // Effect to save column visibility to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('columnVisibility', JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  // Function to toggle theme
  const toggleTheme = () => {
    setIsDarkMode(prevMode => !prevMode);
  };

  // Centralized modal display function
  const showModal = (title, message, type = 'alert', onConfirm = null) => {
    setModalTitle(title);
    setModalMessage(message);
    setModalType(type);
    setModalOnConfirm(() => onConfirm);
    setModalOpen(true);
  };

  // Centralized modal close function
  const closeModal = () => {
    setModalOpen(false);
    setModalTitle('');
    setModalMessage('');
    setModalOnConfirm(null);
    setModalType('alert');
  };

  // Effect to load Tailwind CSS CDN script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdn.tailwindcss.com";
    script.async = true;
    script.onload = () => console.log("Tailwind CSS CDN loaded.");
    script.onerror = (e) => console.error("Error loading Tailwind CSS CDN:", e);
    document.head.appendChild(script);

    return () => {
      // Clean up the script when the component unmounts
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

  // Initialize Firebase and authenticate
  useEffect(() => {
    const initializeFirebase = async () => {
      console.log("Attempting Firebase initialization...");
      setLoading(true);
      setError(null);

      try {
        const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';

        let firebaseConfig = {};
        try {
          firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG_JSON || '{}');
          if (Object.keys(firebaseConfig).length === 0) {
              console.error("Firebase configuration is missing or empty. Please set it in your environment variables.");
              setError(new Error("Firebase configuration is missing or invalid. Cannot initialize."));
              setLoading(false);
              return;
          }
        } catch (e) {
          console.error("Error parsing firebaseConfig:", e);
          setError(new Error("Invalid Firebase configuration JSON provided. " + e.message));
          setLoading(false);
          return;
        }

        if (!firebaseConfig.apiKey) {
          console.error("Firebase config is missing API key. Please check your firebaseConfig.");
          setError(new Error("Firebase configuration is missing API key. Cannot initialize."));
          setLoading(false);
          return;
        }

        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const authentication = getAuth(app);

        setDb(firestore);
        setAuth(authentication);

        console.log("Firebase app and services initialized. Attempting authentication...");
		
        // Use the auth instance directly here
        onAuthStateChanged(authentication, (user) => {
          if (user) {
            setUserId(user.uid);
            setIsLoggedIn(true);
            console.log("Auth state changed. Current User ID:", user.uid);
          } else {
            setUserId(null);
            setIsLoggedIn(false);
            console.log("Auth state changed. No user is signed in.");
          }
        });

      } catch (error) {
        console.error("Caught error during Firebase initialization or authentication:", error);
        setError(new Error("An unexpected error occurred during Firebase setup: " + error.message));
      } finally {
        setLoading(false);
      }
    };

    initializeFirebase();

  }, []);

  // Effect to load admin password from Firestore after Firebase and Auth are ready
  useEffect(() => {
    if (!db || !userId) {
      console.log('Firebase or userId not ready for admin password fetch.');
      return;
    }

   // Using environment variable for appId
    const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
    adminPasswordDocRef.current = doc(db, `artifacts/${appId}/public/data/adminSettings/password`);

   const unsubscribeAdminPassword = onSnapshot(adminPasswordDocRef.current, (docSnap) => {
      if (docSnap.exists() && docSnap.data().adminPassword) {
        setCurrentAdminPassword(docSnap.data().adminPassword);
        console.log("Admin password loaded from Firestore.");
      } else {
        setDoc(adminPasswordDocRef.current, { adminPassword: DEFAULT_ADMIN_PASSWORD }, { merge: true })
          .then(() => {
            setCurrentAdminPassword(DEFAULT_ADMIN_PASSWORD);
            console.log("Default admin password set in Firestore.");
          })
          .catch((e) => console.error("Error setting default admin password:", e));
      }
    }, (error) => {
      console.error("Error fetching admin password:", error);
      setError(new Error("Failed to load admin password: " + error.message));
    });

    return () => {
      console.log('Unsubscribing admin password listener.');
      unsubscribeAdminPassword();
    };
  }, [db, userId]);

  // Set up a real-time interval to update `currentTime` every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Effect to dynamically generate time slots based on current time
  useEffect(() => {
    const generatedSlots = generateTimeSlots(selectedBookingDate, currentTime);
    setDynamicTimeSlots(generatedSlots);
    // Only set the default timeSlot if nothing is currently selected OR
    // if the currently selected slot is no longer available in the generated list.
    if (timeSlot === '' || !generatedSlots.includes(timeSlot)) {
        if (generatedSlots.length > 0) {
            setTimeSlot(generatedSlots[0]);
        } else {
            setTimeSlot('');
        }
    }
  }, [currentTime, selectedBookingDate, timeSlot]); // `timeSlot` added to dependencies to re-evaluate when it changes

  // Removed scroll listener as the button is no longer fixed

  // Fetch entries for "today" and "yesterday" and combine them
  useEffect(() => {
    if (!db || !userId) {
      console.log('Firestore or userId not ready for data fetching. Skipping data listeners.');
      return;
    }
    console.log('Setting up Firestore data listeners for user:', userId);

    // Derive todayISO and yesterdayISO dynamically from currentTime
    const todayDate = currentTime; // Use the continuously updated currentTime
    const year = todayDate.getFullYear();
    const month = String(todayDate.getMonth() + 1).padStart(2, '0');
    const day = String(todayDate.getDate()).padStart(2, '0');
    const todayISO = `${year}-${month}-${day}`;

    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(todayDate.getDate() - 1);
    const yesterdayYear = yesterdayDate.getFullYear();
    const yesterdayMonth = String(yesterdayDate.getMonth() + 1).padStart(2, '0');
    const yesterdayDay = String(yesterdayDate.getDate()).padStart(2, '0');
    const yesterdayISO = `${yesterdayYear}-${yesterdayMonth}-${yesterdayDay}`;


  // Using environment variable for appId
    const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';


    // Setup serial counter listener
    const counterDocRef = doc(db, `artifacts/${appId}/public/data/dailyCounters`, todayISO);
    serialCounterRef.current = counterDocRef;

    const unsubscribeCounter = onSnapshot(counterDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setSerialCounter(docSnap.data().lastSerial || 0);
        console.log('Serial counter updated:', docSnap.data().lastSerial);
      } else {
        setSerialCounter(0);
        console.log('Serial counter document does not exist, starting from 0.');
      }
    }, (error) => {
      console.error("Error fetching serial counter:", error);
      setError(new Error("Failed to load serial counter: " + error.message));
    });

    // Listener for entries created today
    const entriesColRef = collection(db, `artifacts/${appId}/public/data/entries`);
    const qToday = query(entriesColRef, where("date", "==", todayISO));
    const unsubscribeTodayEntries = onSnapshot(qToday, (snapshot) => {
      const fetchedTodayEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTodayEntries(fetchedTodayEntries);
      console.log("Today's entries updated:", fetchedTodayEntries.length);
    }, (error) => {
      console.error("Error fetching today's entries:", error);
      setError(new Error("Failed to load today's entries: " + error.message));
    });

    // Listener for entries created yesterday (to catch overnight sessions)
    const qYesterday = query(entriesColRef, where("date", "==", yesterdayISO));
    const unsubscribeYesterdayEntries = onSnapshot(qYesterday, (snapshot) => {
      const fetchedYesterdayEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setYesterdayEntries(fetchedYesterdayEntries);
      console.log("Yesterday's entries updated:", fetchedYesterdayEntries.length);
    }, (error) => {
      console.error("Error fetching yesterday's entries:", error);
      setError(new Error("Failed to load yesterday's entries: " + error.message));
    });

    // Setup beverages listener
    const beveragesColRef = collection(db, `artifacts/${appId}/public/data/beverages`);
    const unsubscribeBeverages = onSnapshot(beveragesColRef, (snapshot) => {
      const beveragesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setBeverages(beveragesData);
      console.log("Beverages updated:", beveragesData.length);
    }, (error) => {
      console.error("Error fetching beverages:", error);
      setError(new Error("Failed to load beverages: " + error.message));
    });

    // Setup advance bookings listener
    const advanceBookingsColRef = collection(db, `artifacts/${appId}/public/data/advanceBookings`);
    const qAdvanceBookings = query(advanceBookingsColRef, where("bookingDate", "==", selectedBookingDateForTable));
    const unsubscribeAdvanceBookings = onSnapshot(qAdvanceBookings, (snapshot) => {
      const fetchedBookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAdvanceBookings(fetchedBookings.sort((a, b) => {
        // Sort by time slot for consistent display
        const timeA = parseTimeSlotStart(a.timeSlot, a.bookingDate);
        const timeB = parseTimeSlotStart(b.timeSlot, b.bookingDate);
        return timeA.getTime() - timeB.getTime();
      }));
      console.log("Advance bookings updated:", fetchedBookings.length);
    }, (error) => {
      console.error("Error fetching advance bookings:", error);
      setError(new Error("Failed to load advance bookings: " + error.message));
    });

    // NEW: Setup customers listener
    const customersColRef = collection(db, `artifacts/${appId}/public/data/customers`);
    const unsubscribeCustomers = onSnapshot(customersColRef, (snapshot) => {
      const customersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCustomers(customersData);
      console.log("Customers updated:", customersData.length);
    }, (error) => {
      console.error("Error fetching customers:", error);
      setError(new Error("Failed to load customers: " + error.message));
    });


    return () => {
      console.log('Unsubscribing all Firestore listeners.');
      unsubscribeCounter();
      unsubscribeTodayEntries();
      unsubscribeYesterdayEntries();
      unsubscribeBeverages();
      unsubscribeAdvanceBookings(); // Unsubscribe advance bookings listener
      unsubscribeCustomers(); // NEW: Unsubscribe customers listener
    };
  }, [db, userId, currentTime, selectedBookingDateForTable]); // Add currentTime to dependencies to re-run on date change

  // Effect to combine and filter entries for display based on new filter states
  useEffect(() => {
    let combinedAndFilteredEntries = [];
	if (showAllTodayEntries) {
      combinedAndFilteredEntries = [...todayEntries];
    } else {
	const allRecentEntries = [...todayEntries, ...yesterdayEntries];
	
	// The table will now always show all entries for today and active/recently finished entries from yesterday.
    combinedAndFilteredEntries = allRecentEntries.filter(entry => {
      const { status } = calculateRemainingTimeAndStatus(entry, entry.outTime, currentTime);
      const outTimeMoment = new Date(`${entry.date}T${entry.outTime}`);
      if (outTimeMoment < new Date(`${entry.date}T${entry.entryTime}`)) {
        outTimeMoment.setDate(outTimeMoment.getDate() + 1);
      }
      const timeSinceOutMs = currentTime.getTime() - outTimeMoment.getTime();
      const bufferMinutes = 30; // Changed from 60
		
	  return status === 'active' || status === 'final-seconds' || status === 'critical-minutes' || (status === 'time-up' && timeSinceOutMs <= bufferMinutes * 60 * 1000);	

    });
	}
	// Sort in reverse order (latest serial number first)
    setEntries(combinedAndFilteredEntries.sort((a, b) => b.serialNumber - a.serialNumber));

    const sum = todayEntries.reduce((acc, entry) => acc + (entry.totalBill || 0), 0);
    setTodayTotalCollection(sum);

  }, [todayEntries, yesterdayEntries, currentTime, showAllTodayEntries, showCurrentActiveEntries]);

  // NEW: Effect to trigger Time-Up Notification
  useEffect(() => {
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = null;
    }

    const firstTimeUpEntry = entries.find(entry => {
      const { status } = calculateRemainingTimeAndStatus(entry, entry.outTime, currentTime);
      return status === 'time-up' && !notifiedEntryIds.current.has(entry.id);
    });

    if (firstTimeUpEntry) {
      setNotifiedEntry(firstTimeUpEntry);
      setShowTimeUpNotification(true);
      notifiedEntryIds.current.add(firstTimeUpEntry.id);

      notificationTimerRef.current = setTimeout(() => {
        setShowTimeUpNotification(false);
        setNotifiedEntry(null);
      }, 15000);
    }

    return () => {
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, [entries, currentTime]);

  // NEW: Function to manually dismiss the time-up notification
  const handleDismissTimeUpNotification = () => {
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = null;
    }
    setShowTimeUpNotification(false);
    setNotifiedEntry(null);
  };

  // NEW: Notes feature functions
  const handleNotesClick = (entry) => {
      setCurrentEntryForNotes(entry);
      setNoteText(entry.notes || '');
      setShowNotesModal(true);
  };

  const handleSaveNote = async () => {
      if (!currentEntryForNotes || !db) return;
      try {
          const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
          const entryRef = doc(db, `artifacts/${appId}/public/data/entries`, currentEntryForNotes.id);
          await updateDoc(entryRef, {
              notes: noteText
          });
          showModal("Success", "Note saved successfully!");
          setShowNotesModal(false);
          setCurrentEntryForNotes(null);
          setNoteText('');
      } catch (e) {
          console.error("Error saving note:", e);
          showModal("Error", "Failed to save note.");
      }
  };

  const handleDeleteNote = async () => {
      if (!currentEntryForNotes || !db) return;
      try {
          const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
          const entryRef = doc(db, `artifacts/${appId}/public/data/entries`, currentEntryForNotes.id);
          await updateDoc(entryRef, {
              notes: deleteField()
          });
          showModal("Success", "Note deleted successfully!");
          setShowNotesModal(false);
          setCurrentEntryForNotes(null);
          setNoteText('');
      } catch (e) {
          console.error("Error deleting note:", e);
          showModal("Error", "Failed to delete note.");
      }
  };
  
  const fetchLastNoteForCustomer = async (mobileNumber) => {
    if (!db || mobileNumber.length !== 10) {
        setPreviousNoteInfo(null);
        return;
    }

    try {
        const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
        const entriesColRef = collection(db, `artifacts/${appId}/public/data/entries`);
        const q = query(
            entriesColRef, 
            where("mobileNumber", "==", mobileNumber)
        );

        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            setPreviousNoteInfo(null);
            return;
        }

        // Find the most recent entry with a note
        let latestEntryWithNote = null;
        querySnapshot.docs.forEach(doc => {
            const entry = doc.data();
            if (entry.notes) {
                const entryTimestamp = entry.timestamp?.toDate() || new Date(0);
                if (!latestEntryWithNote || entryTimestamp > (latestEntryWithNote.timestamp?.toDate() || new Date(0))) {
                    latestEntryWithNote = { ...entry, timestamp: entry.timestamp };
                }
            }
        });
        
        if (latestEntryWithNote) {
            setPreviousNoteInfo({ 
                note: latestEntryWithNote.notes,
                from: latestEntryWithNote.name,
                date: latestEntryWithNote.timestamp?.toDate().toLocaleDateString('en-GB') || 'an older session'
            });
        } else {
            setPreviousNoteInfo(null);
        }

    } catch (e) {
        console.error("Error fetching last note:", e);
        setPreviousNoteInfo(null);
    }
};

  /**
   * Function to calculate total hours from duration in minutes.
   * @param {number} durationInMinutes - The duration in minutes.
   * @returns {number} The duration in hours.
   */
  const calculateTotalHours = (durationInMinutes) => {
    if (isNaN(durationInMinutes) || durationInMinutes <= 0) return 0;
    return durationInMinutes / 60;
  };

  /**
   * Function to calculate remaining time, returning display string, status for coloring/blinking,
   * and percentage for horizontal fill.
   * @param {object} entry - The entry object containing entryTime, original date, and durationMinutes.
   * @param {string} out - The out time string (e.g., "14:30").
   * @param {Date} currentMoment - The current time (Date object) for calculation.
   * @returns {{display: string, minutes: number, status: string, percentage: number}}
   */
  const calculateRemainingTimeAndStatus = (entry, out, currentMoment) => {
    if (!entry || !out) return { display: 'N/A', minutes: -1, status: 'unknown', percentage: 0 };

    const now = currentMoment;
    const entryDatePart = entry.date;

    const entryDateTime = new Date(`${entryDatePart}T${entry.entryTime}`);
    let outDateTime = new Date(`${entryDatePart}T${out}`);

    // Adjust outDateTime to the next day if it's earlier than entryDateTime
    // This handles sessions that cross midnight.
    if (outDateTime.getTime() < entryDateTime.getTime()) {
      outDateTime.setDate(outDateTime.getDate() + 1);
    }

    const remainingMs = outDateTime.getTime() - now.getTime();
    
    let displayString;
    let status = 'active';

    // Calculate percentage based on the original session duration
    const totalSessionDurationMs = (entry.durationMinutes || 60) * 60 * 1000; // Default to 60 min if durationMinutes is missing
    let percentageRemaining = (remainingMs / totalSessionDurationMs) * 100;
    percentageRemaining = Math.max(0, Math.min(100, percentageRemaining)); // Clamp between 0 and 100

    // Define thresholds for status changes
    if (remainingMs <= 0) {
      displayString = "Time's Up!";
      status = 'time-up';
      percentageRemaining = 0; // Ensure liquid is completely drained
    } else if (remainingMs > 0 && remainingMs <= 1 * 60 * 1000) { // Last 1 minute (60 seconds)
      const secondsRemaining = Math.ceil(remainingMs / 1000);
      displayString = `${secondsRemaining} sec left`;
      status = 'final-seconds'; // Blinking for the last minute
    } else if (remainingMs > 1 * 60 * 1000 && remainingMs <= 5 * 60 * 1000) { // Last 5 minutes
      const totalMinutes = Math.floor(remainingMs / (1000 * 60));
      displayString = `${totalMinutes} min${totalMinutes > 1 ? 's' : ''} left`;
      status = 'critical-minutes';
    } else {
      const totalMinutes = Math.floor(remainingMs / (1000 * 60));
      const hours = Math.floor(totalMinutes / 60);
      const minutesPart = totalMinutes % 60;
      if (hours > 0) {
        displayString = `${hours} hr${hours > 1 ? 's' : ''} ${minutesPart} min${minutesPart > 1 ? 's' : ''} left`;
      } else {
        displayString = `${minutesPart} min${minutesPart > 1 ? 's' : ''} left`;
      }
      status = 'active';
    }

    return {
      display: displayString,
      minutes: Math.floor(remainingMs / (1000 * 60)),
      status: status,
      percentage: percentageRemaining
    };
  };

  /**
   * Converts a 24-hour time string (HH:MM) to 12-hour format (HH:MM AM/PM).
   * @param {string} timeString - The time in HH:MM format.
   * @returns {string} The time in 12-hour format with AM/PM.
   */
  const formatTimeTo12Hr = (timeString) => {
    if (!timeString) return '';
    try {
      const [hours, minutes] = timeString.split(':').map(Number);
      const date = new Date(); // Using a dummy date to handle time formatting
      date.setHours(hours, minutes, 0, 0);
      let h = date.getHours();
      const m = date.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      h = h ? h : 12; // The hour '0' should be '12 AM'
      const formattedMinutes = m < 10 ? '0' + m : minutes;
      return `${h}:${formattedMinutes} ${ampm}`;
    } catch (e) {
      console.error("Error formatting time to 12hr:", timeString, e);
      return timeString;
    }
  };

  // Helper to convert HH:MM string and duration (minutes) to an HH:MM outTime string
  const calculateOutTime = (entryTimeStr, durationMinutes) => {
    if (!entryTimeStr || isNaN(durationMinutes)) return '';

    const [entryHours, entryMinutes] = entryTimeStr.split(':').map(Number);
    const dummyDate = new Date(); // Use today's date for initial context
    dummyDate.setHours(entryHours, entryMinutes, 0, 0);

    const outDateTime = new Date(dummyDate.getTime() + durationMinutes * 60 * 1000);

    const outHours = outDateTime.getHours();
    const outMins = outDateTime.getMinutes();

    return `${String(outHours).padStart(2, '0')}:${String(outMins).padStart(2, '0')}`;
  };

  // Helper to get duration in minutes from an entry's entryTime and outTime for edit modal pre-selection
  const getDurationFromTimes = (entryTimeStr, outTimeStr) => {
      if (!entryTimeStr || !outTimeStr) return DURATION_OPTIONS[0].value; // Default to first option

      // Use a consistent dummy date to calculate duration correctly, even across midnight
      const dummyDate = new Date().toISOString().slice(0, 10);

      const entryDateTime = new Date(`${dummyDate}T${entryTimeStr}`);
      let outDateTime = new Date(`${dummyDate}T${outTimeStr}`);

      // If outTime is earlier than entryTime (e.g., 23:00 to 01:00), it means it's the next day
      if (outDateTime.getTime() < entryDateTime.getTime()) {
          outDateTime.setDate(outDateTime.getDate() + 1);
      }

      const diffMs = outDateTime.getTime() - entryDateTime.getTime();
      const durationInMinutes = Math.round(diffMs / (1000 * 60)); // Round to nearest minute

      // Check if this duration matches any predefined option
      const matchedOption = DURATION_OPTIONS.find(option => option.value === durationInMinutes);
      if (matchedOption) {
          return matchedOption.value;
      }
      
      // If no match, it's a custom duration, return 'custom'
      return 'custom';
  };


  // Function to calculate total gaming pricing based on option AND hours
const calculateGamingSessionPrice = (option, hours, customHourlyRate = 0, isDiscountApplied = false) => {
  if (isNaN(hours) || hours <= 0) return 0;

  // For "Custom Price", the calculation is always exact and ignores discounts.
  if (option === 'Custom Price') {
    return (parseFloat(customHourlyRate) || 0) * hours;
  }

  let billedHours;

  // For all other standard options, determine the hours to bill.
  if (isDiscountApplied && hours >= 1.5) {
    // If discount is applied AND time is 1.5 hours or more, give 30 mins free.
    billedHours = hours - 0.5;
  } else {
    // Otherwise (no discount OR time is less than 1.5 hours), use the 1-hour minimum rule.
    billedHours = Math.max(1, hours);
  }

  // Return the final price based on the hourly rate and the calculated billed hours.
  return (GAMING_HOURLY_PRICES[option] || 0) * billedHours;
};

  // Function to calculate total beverage pricing for a given entry
  const calculateEntryBeveragePricing = (entryBeverages) => {
    let total = 0;
    const safeEntryBeverages = entryBeverages || {};
    if (Object.keys(safeEntryBeverages).length > 0) { // Check if there are any beverages selected
      Object.entries(safeEntryBeverages).forEach(([beverageKey, quantity]) => {
        // Use SORTED_FIXED_BEVERAGE_PRICES for lookup first
        if (SORTED_FIXED_BEVERAGE_PRICES[beverageKey] !== undefined) {
          total += (SORTED_FIXED_BEVERAGE_PRICES[beverageKey] || 0) * quantity;
        } else {
          // Fallback to dynamically added beverages
          const beverage = beverages.find(b => b.id === beverageKey);
          if (beverage) {
            total += (beverage.price || 0) * quantity;
          }
        }
      });
    }
    return total;
  };

  // Handle adding a new beverage to the available list (for admin)
  const handleAddBeverage = async () => {
    if (!db || !newBeverageName || newBeveragePrice === '') {
      showModal("Validation Error", "Please enter both beverage name and price.");
      return;
    }
    // Check against the keys of the sorted fixed prices
    if (SORTED_FIXED_BEVERAGE_PRICES[newBeverageName]) {
      showModal("Validation Error", `"${newBeverageName}" is a reserved beverage name. Please choose a different name.`);
      return;
    }
    if (beverages.some(b => b.name === newBeverageName)) {
      showModal("Validation Error", `Beverage "${newBeverageName}" already exists. Please choose a different name.`);
      return;
    }

try {
      const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id'; // Use env var
      await addDoc(collection(db, `artifacts/${appId}/public/data/beverages`), {
        name: newBeverageName,
        price: parseFloat(newBeveragePrice),
      });
      setNewBeverageName('');
      setNewBeveragePrice('');
      console.log("Beverage added successfully.");
    }
    catch (e) {
      console.error("Error adding beverage: ", e);
      showModal("Error", "Failed to add beverage. Please try again.");
    }
  };

  const handleDeleteBeverage = async (id) => {
    if (!db) return;
    try {
      const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id'; // Use env var
      await deleteDoc(doc(db, `artifacts/${appId}/public/data/beverages`, id));
      console.log("Beverage deleted successfully.");
    } catch (e) {
      console.error("Error deleting beverage: ", e);
      showModal("Error", "Failed to delete beverage. Please try again.");
    }
  };

  // Handle quantity change for an already selected beverage (in the display box)
  const updateAddedBeverageQuantity = (beverageKey, quantity) => {
    setSelectedBeverages(prev => {
      const newSelected = { ...prev };
      if (quantity > 0) {
        newSelected[beverageKey] = quantity;
      } else {
        delete newSelected[beverageKey]; // Remove if quantity is 0 or less
      }
      return newSelected;
    });
  };

  // Handle quantity change for an already selected beverage in EDIT mode
  const updateEditAddedBeverageQuantity = (beverageKey, quantity) => {
    setEditSelectedBeverages(prev => {
      const newSelected = { ...prev };
      if (quantity > 0) {
        newSelected[beverageKey] = quantity;
      } else {
        delete newSelected[beverageKey]; // Remove if quantity is 0 or less
      }
      return newSelected;
    });
  };

  // NEW: Handler for the first beverage dropdown (Add Entry form)
  const handleTempBeverageChange = (e) => {
    setTempSelectedBeverageId(e.target.value);
    // When a new beverage is selected, reset quantity to 1 if not already selected
    if (e.target.value && !selectedBeverages[e.target.value]) {
        setTempSelectedBeverageQuantity(1);
    } else if (selectedBeverages[e.target.value]) {
        // If already in cart, pre-fill with its current quantity
        setTempSelectedBeverageQuantity(selectedBeverages[e.target.value]);
    } else {
        setTempSelectedBeverageQuantity(1); // Default if no beverage or new selection
    }
  };

  // NEW: Handler for the quantity dropdown (Add Entry form)
  const handleTempQuantityChange = (e) => {
    setTempSelectedBeverageQuantity(parseInt(e.target.value));
  };

  // NEW: Handler for adding the temporarily selected beverage to the main list (Add Entry form)
  const handleAddBeverageToEntry = () => {
    if (tempSelectedBeverageId && tempSelectedBeverageQuantity > 0) {
      setSelectedBeverages(prev => ({
        ...prev,
        [tempSelectedBeverageId]: tempSelectedBeverageQuantity,
      }));
      setTempSelectedBeverageId(''); // Reset dropdown
      setTempSelectedBeverageQuantity(1); // Reset quantity
    } else {
      showModal("Selection Error", "Please select a beverage and a quantity.");
    }
  };

  // NEW: Handler for removing a beverage from the selected list (Add Entry form)
  const handleRemoveSelectedBeverage = (beverageKey) => {
    setSelectedBeverages(prev => {
      const newSelected = { ...prev };
      delete newSelected[beverageKey];
      return newSelected;
    });
  };

  // NEW: Handler for the first beverage dropdown (Edit Entry form)
  const handleEditTempBeverageChange = (e) => {
    setEditTempSelectedBeverageId(e.target.value);
    // Reset quantity to 1 if not already selected, or pre-fill if it is
    if (e.target.value && !editSelectedBeverages[e.target.value]) {
        setEditTempSelectedBeverageQuantity(1);
    } else if (editSelectedBeverages[e.target.value]) {
        setEditTempSelectedBeverageQuantity(editSelectedBeverages[e.target.value]);
    } else {
        setEditTempSelectedBeverageQuantity(1);
    }
  };

  // NEW: Handler for the quantity dropdown (Edit Entry form)
  const handleEditTempQuantityChange = (e) => {
    setEditTempSelectedBeverageQuantity(parseInt(e.target.value));
  };

  // NEW: Handler for adding the temporarily selected beverage to the main list (Edit Entry form)
  const handleEditAddBeverageToEntry = () => {
    if (editTempSelectedBeverageId && editTempSelectedBeverageQuantity > 0) {
      setEditSelectedBeverages(prev => ({
        ...prev,
        [editTempSelectedBeverageId]: editTempSelectedBeverageQuantity,
      }));
      setEditTempSelectedBeverageId(''); // Reset dropdown
      setEditTempSelectedBeverageQuantity(1); // Reset quantity
    } else {
      showModal("Selection Error", "Please select a beverage and a quantity.");
    }
  };

  // Helper to get beverage display name from key (handling both fixed and dynamic)
  const getBeverageDisplayName = (beverageKey) => {
    if (SORTED_FIXED_BEVERAGE_PRICES[beverageKey] !== undefined) {
      return beverageKey; // Fixed beverage names are their keys
    }
    const dynamicBev = beverages.find(b => b.id === beverageKey);
    return dynamicBev ? dynamicBev.name : 'Unknown Beverage';
  };

  // Helper to get beverage price from key (handling both fixed and dynamic)
  const getBeveragePrice = (beverageKey) => {
    if (SORTED_FIXED_BEVERAGE_PRICES[beverageKey] !== undefined) {
      return SORTED_FIXED_BEVERAGE_PRICES[beverageKey];
    }
    const dynamicBev = beverages.find(b => b.id === beverageKey);
    return dynamicBev ? dynamicBev.price : 0;
  };

 // Use useMemo to create a sorted list of all available beverages
  const allAvailableBeverages = useMemo(() => {
    const combined = [
      ...Object.entries(SORTED_FIXED_BEVERAGE_PRICES).map(([name, price]) => ({ id: name, name: name, price: price })),
      ...beverages.map(bev => ({ id: bev.id, name: bev.name, price: bev.price }))
    ];
    // Sort by price (low to high)
    return combined.sort((a, b) => a.price - b.price);
  }, [beverages]); // Re-calculate only when 'beverages' (dynamic ones) change

  // NEW: Memoized list of active stations and available stations (slot-based for PS)
  const { occupiedPSSlots, occupiedOtherStations, occupiedPSGamingTypes } = useMemo(() => {
    const psSlots = {};
    const psGamingTypes = {}; // NEW: Store the gaming option type currently on the station
    PS_STATIONS.forEach(station => {
        psSlots[station] = 0;
        psGamingTypes[station] = null; // Initialize to null
    });
    const otherStationsOccupied = new Set(); // For PC and Racing Cockpit (full occupancy)

    const allRelevantEntries = [...todayEntries, ...yesterdayEntries];

    allRelevantEntries.forEach(entry => {
      if (entry.stationNumber) {
        const { status } = calculateRemainingTimeAndStatus(entry, entry.outTime, currentTime);
        const outTimeMoment = new Date(`${entry.date}T${entry.entryTime}`);
        if (outTimeMoment < new Date(`${entry.date}T${entry.entryTime}`)) {
            outTimeMoment.setDate(outTimeMoment.getDate() + 1);
        }
        const timeSinceOutMs = currentTime.getTime() - outTimeMoment.getTime();
        const bufferMinutes = 30;

	if (
		status === 'active' ||
		status === 'final-seconds' ||
		status === 'critical-minutes'
		) {
		const slotsConsumed = getSlotsConsumed(entry.gamingOption);

	if (PS_STATIONS.includes(entry.stationNumber)) {
    psSlots[entry.stationNumber] += slotsConsumed;

    if (psGamingTypes[entry.stationNumber] === null) {
      psGamingTypes[entry.stationNumber] = entry.gamingOption;
    } else if (
      psGamingTypes[entry.stationNumber] !== entry.gamingOption &&
      psGamingTypes[entry.stationNumber] !== 'mixed'
    ) {
      psGamingTypes[entry.stationNumber] = 'mixed';
    }
	} else if (
		PC_STATIONS.includes(entry.stationNumber) ||
		entry.gamingOption === 'Racing Cockpit'
	) {
		otherStationsOccupied.add(entry.stationNumber);
	 }
	}
     }
    });
    return { occupiedPSSlots: psSlots, occupiedOtherStations: otherStationsOccupied, occupiedPSGamingTypes: psGamingTypes };
}, [todayEntries, yesterdayEntries, currentTime]);

const totalPC = PC_STATIONS.length;
const totalPS = PS_STATIONS.length;

const availablePCStations = PC_STATIONS.filter(station => !occupiedOtherStations.has(station));
const availablePSStations = PS_STATIONS.filter(station => {
  const slotsUsed = occupiedPSSlots[station] || 0;
  return PS_STATION_CAPACITY - slotsUsed >= 1;
});

const availablePC = availablePCStations.length;
const availablePS = availablePSStations.length;

  // NEW: Filtered station options for the "Add Entry" and "Edit Entry" forms
  const getFilteredStationOptions = useMemo(() => {
    return (forGamingOption, isEditMode = false, currentEntryStation = null, currentEntryGamingOption = null) => {
      const psStations = PS_STATIONS;
      const pcStations = PC_STATIONS;
      const allStations = ALL_STATIONS; 

      const slotsNeeded = getSlotsConsumed(forGamingOption);

      let filtered = [];

      if (forGamingOption.startsWith('PC')) {
        filtered = pcStations.filter(station => {
          if (isEditMode && station === currentEntryStation) return true;
          return !occupiedOtherStations.has(station);
        });
      } else if (forGamingOption.startsWith('PS')) {
	filtered = psStations.filter(station => {
  if (isEditMode && station === currentEntryStation) return true;

  let currentOccupied = occupiedPSSlots[station] || 0;

  if (isEditMode && station === currentEntryStation && currentEntryGamingOption) {
    const currentEntrySlots = getSlotsConsumed(currentEntryGamingOption);
    currentOccupied = Math.max(0, currentOccupied - currentEntrySlots);
  }

  const availableSlots = PS_STATION_CAPACITY - currentOccupied;
  const currentType = occupiedPSGamingTypes[station];

  // ❌ Block if not enough slots
  if (availableSlots < getSlotsConsumed(forGamingOption)) return false;

  // ❌ Block if mixed or different PS type
  if (currentType === 'mixed' || (currentType && currentType !== forGamingOption)) {
    return false;
  }

  return true;
});	

      } else if (forGamingOption === 'Racing Cockpit') { // <--- Focus on this part
    // Filter only PC stations
    filtered = pcStations.filter(station => {
        if (isEditMode && station === currentEntryStation) return true;
        return !occupiedOtherStations.has(station);
    });
	} else if (forGamingOption === 'Custom Price') { // <--- Keep Custom Price separate if it can use both
    // Keep existing logic for Custom Price if it can use both PC and PS stations
    filtered = allStations.filter(station => {
        if (isEditMode && station === currentEntryStation) return true;

        if (PC_STATIONS.includes(station)) {
            return !occupiedOtherStations.has(station);
        } else if (PS_STATIONS.includes(station)) {
            return (PS_STATION_CAPACITY - (occupiedPSSlots[station] || 0)) >= 1;
        }
        return false;
    });
	}
      return filtered;
    };
  }, [occupiedPSSlots, occupiedOtherStations]);

  // Handle form submission for a new entry
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!db || !userId) {
      showModal("Authentication Error", "Firebase not initialized or user not authenticated.");
      return;
    }

    if (!name || !mobileNumber || !entryTime) {
      showModal("Validation Error", "Please fill in all required fields (Name, Mobile, Entry Time).");
      return;
    }

    // Validate station number based on gaming option
    const availableStationsForSelection = getFilteredStationOptions(gamingOption);
    if ((gamingOption.startsWith('PC') || gamingOption.startsWith('PS') || gamingOption === 'Racing Cockpit' || gamingOption === 'Custom Price') && !stationNumber) {
        showModal("Validation Error", "Please select a Station Number.");
        return;
    }
    if ((gamingOption.startsWith('PC') || gamingOption.startsWith('PS') || gamingOption === 'Racing Cockpit' || gamingOption === 'Custom Price') && !availableStationsForSelection.includes(stationNumber)) {
        showModal("Validation Error", `Station ${stationNumber} is not available or invalid for the selected gaming option.`);
        return;
    }

    // Determine actual duration in minutes based on selection
    let actualDurationMinutes;
    if (duration === 'custom') {
        // Custom duration is now in hours, convert to minutes
        if (!customDuration || isNaN(parseFloat(customDuration)) || parseFloat(customDuration) <= 0) {
            showModal("Validation Error", "Please enter a valid custom duration in hours greater than zero.");
            return;
        }
        actualDurationMinutes = parseFloat(customDuration) * 60; // Convert hours to minutes
    } else {
        actualDurationMinutes = duration; // This is already a number from DURATION_OPTIONS (in minutes)
    }

    if (gamingOption === 'Custom Price' && (customGamingPrice === '' || isNaN(parseFloat(customGamingPrice)) || parseFloat(customGamingPrice) <= 0)) {
      showModal("Validation Error", "Please enter a valid custom hourly price greater than zero.");
      return;
    }

    const mobileRegex = /^\d{10}$/;
    if (!mobileRegex.test(mobileNumber)) {
      showModal("Validation Error", "Mobile Number must contain exactly 10 numeric digits.");
      return;
    }

    setIsSubmitting(true);
    try {
      const submitDate = new Date();
      // Ensure entryISO captures the local calendar date
      const year = submitDate.getFullYear();
      const month = String(submitDate.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
      const day = String(submitDate.getDate()).padStart(2, '0');
      const entryISO = `${year}-${month}-${day}`;

      // Calculate outTime based on entryTime and selected duration
      const calculatedOutTime = calculateOutTime(entryTime, actualDurationMinutes);
	  const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id'; // Use env var
      // Increment serial number
      const newSerial = serialCounter + 1;
      // Use serialCounterRef.current to update the Firestore document
      await setDoc(serialCounterRef.current, { lastSerial: newSerial, timestamp: serverTimestamp() }, { merge: true });

      const totalHoursCalculated = calculateTotalHours(actualDurationMinutes);
	  const gamingPrice = calculateGamingSessionPrice(gamingOption, totalHoursCalculated, customGamingPrice, applyDiscount);
      const beveragePrice = calculateEntryBeveragePricing(selectedBeverages);
      const totalBill = gamingPrice + beveragePrice;

      // Filter out beverages with quantity 0 before saving
      const beveragesToSave = Object.fromEntries(
        Object.entries(selectedBeverages).filter(([, qty]) => qty > 0)
      );

      const entryData = {
        serialNumber: newSerial,
        date: entryISO, // This will now always be the current local calendar date
        name,
        mobileNumber,
        gamingOption,
		stationNumber: stationNumber || null, // NEW: Save station number, default to null if not selected
        entryTime,
        outTime: calculatedOutTime, // Store the calculated outTime
        durationMinutes: actualDurationMinutes, // Store the actual duration in minutes
        totalHours: totalHoursCalculated,
        gamingPricing: gamingPrice,
        beverages: beveragesToSave, // Save filtered beverages
        beveragePricing: beveragePrice,
        totalBill: totalBill,
        paymentMethod,
        timestamp: serverTimestamp(),
        // NEW: QR Code Implementation - Add redemption token and status
      };
	  
	// 🔑 Generate QR redemption token here
		const redemptionToken = uuidv4();
		const entryDataWithToken = {
		...entryData,
		isDiscountApplied: applyDiscount,
		redemptionToken,
		isRedeemed: false,
		};

		setQrCodeData(redemptionToken);
		if (serverInfo) {
            const renderServerUrl = "https://fun4youqr.onrender.com"; // Replace with your actual Render URL
			setRedemptionFullUrl(`${renderServerUrl}/redeem?token=${redemptionToken}`);
        }

      if (gamingOption === 'Custom Price') {
        entryData.customHourlyRate = parseFloat(customGamingPrice);
      }
      
      await addDoc(collection(db, `artifacts/${appId}/public/data/entries`), entryDataWithToken);

      // NEW: Update or add customer details
      const customersColRef = collection(db, `artifacts/${appId}/public/data/customers`);
      const q = query(customersColRef, where("mobileNumber", "==", mobileNumber));
      const customerSnapshot = await getDocs(q);

      if (customerSnapshot.empty) {
        // Customer does not exist, add new customer
        await addDoc(customersColRef, {
          name,
          mobileNumber,
          lastVisited: serverTimestamp(),
        });
        console.log("New customer added.");
      } else {
        // Customer exists, update last visited timestamp
        const customerDoc = customerSnapshot.docs[0];
        await updateDoc(doc(db, `artifacts/${appId}/public/data/customers`, customerDoc.id), {
          name, // Update name in case it was changed
          lastVisited: serverTimestamp(),
        });
        console.log("Existing customer updated.");
      }

      // Clear form
      setName('');
      setMobileNumber('');
      setEntryTime('');
      setDuration(DURATION_OPTIONS[0].value); // Reset duration to default
      setCustomDuration(''); // Clear custom duration input
      setGamingOption('PC');
	  setStationNumber('');
      setSelectedBeverages({}); // Clear selected beverages
      setTempSelectedBeverageId(''); // Clear temp beverage selection
      setTempSelectedBeverageQuantity(1); // Reset temp quantity
      setPaymentMethod('Cash');
      setCustomGamingPrice('');
	  setPreviousNoteInfo(null);
      showModal("Success", "New entry added successfully!");
      console.log("New entry added successfully.");
    } catch (e) {
      console.error("Error adding document: ", e);
      showModal("Error", "Error adding entry. Please check console for details.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Function to open the edit modal (for comprehensive editing including beverages)
  const handleEditClick = (entry) => {
    // Calculate the 'out' Date object based on entry.date and entry.outTime
    const outDateTimeForCalculation = new Date(`${entry.date}T${entry.outTime}`);
    // Adjust for overnight sessions if entry.outTime is earlier than entry.entryTime
    const entryDateTimeForCalculation = new Date(`${entry.date}T${entry.entryTime}`);
    if (outDateTimeForCalculation.getTime() < entryDateTimeForCalculation.getTime()) {
        outDateTimeForCalculation.setDate(outDateTimeForCalculation.getDate() + 1);
    }

    // Calculate the lockout time: outTime + 30 minutes
    const lockoutDateTime = new Date(outDateTimeForCalculation.getTime() + 30 * 60 * 1000);

    // Get current time
    const now = new Date();

    if (now.getTime() > lockoutDateTime.getTime()) {
        // More than 30 minutes past outTime, require password
        setEntryToEditAfterPassword(entry);
        setEditAttemptPassword('');
        setEditAttemptPasswordError('');
        setShowEditPasswordModal(true);
    } else {
        // Still within 30 minutes past outTime (or before it), no password needed
        openMainEditModal(entry);
    }
  };

  // Helper function to open the main edit modal
  const openMainEditModal = (entry) => {
    setCurrentEditEntry(entry);
    setEditGamingOption(entry.gamingOption);
	setEditStationNumber(entry.stationNumber || '');
    
    // Determine the duration value for the dropdown and potentially the custom input
    const entryDurationVal = getDurationFromTimes(entry.entryTime, entry.outTime);
    setEditDuration(entryDurationVal);
    // If the duration is 'custom', set the customDuration state as well
    if (entryDurationVal === 'custom') {
        // Pre-fill custom duration with original duration in HOURS
        setEditCustomDuration((entry.durationMinutes / 60) || '');
    } else {
        setEditCustomDuration(''); // Clear custom duration if not 'custom'
    }

    setEditSelectedBeverages(entry.beverages || {});
    setEditTempSelectedBeverageId(''); // Reset temp beverage selection for edit
    setEditTempSelectedBeverageQuantity(1); // Reset temp quantity for edit

    setEditPaymentMethod(entry.paymentMethod);
    setEditCustomGamingPrice(entry.gamingOption === 'Custom Price' ? (entry.customHourlyRate || '') : '');
	setEditApplyDiscount(entry.isDiscountApplied || false); // <-- ADD THIS LINE
    setIsEditing(true);
  };

  // Handle password submission for editing
  const handleVerifyEditPassword = () => {
    if (editAttemptPassword === currentAdminPassword) { // Use currentAdminPassword
      setShowEditPasswordModal(false);
      setEditAttemptPasswordError('');
      if (entryToEditAfterPassword) {
        openMainEditModal(entryToEditAfterPassword);
        setEntryToEditAfterPassword(null);
      }
    } else {
      setEditAttemptPasswordError('Incorrect password. Please try again.');
    }
  };


  // Function to close the edit modal
  const handleCloseEditModal = () => {
    setIsEditing(false);
    setCurrentEditEntry(null);
    setEditCustomGamingPrice('');
    setEditCustomDuration(''); // Clear custom duration input in edit modal
  };

  // Handle update submission for MODAL editing
  const handleUpdateEntry = async (e) => {
    e.preventDefault();
    if (!db || !currentEditEntry) {
      showModal("Error", "No entry selected for editing.");
      return;
    }

    // Validate station number for edit modal
    const availableStationsForEditSelection = getFilteredStationOptions(editGamingOption, true, currentEditEntry.stationNumber, currentEditEntry.gamingOption);
    if ((editGamingOption.startsWith('PC') || editGamingOption.startsWith('PS') || editGamingOption === 'Racing Cockpit' || editGamingOption === 'Custom Price') && !editStationNumber) {
        showModal("Validation Error", "Please select a Station Number for the edited entry.");
        return;
    }
    if ((editGamingOption.startsWith('PC') || editGamingOption.startsWith('PS') || editGamingOption === 'Racing Cockpit' || editGamingOption === 'Custom Price') && !availableStationsForEditSelection.includes(editStationNumber)) {
        showModal("Validation Error", `Station ${editStationNumber} is not available or invalid for the selected gaming option.`);
        return;
    }


    // Determine actual duration in minutes based on selection in edit modal
    let actualEditDurationMinutes;
    if (editDuration === 'custom') {
        // Custom duration is now in hours, convert to minutes
        if (!editCustomDuration || isNaN(parseFloat(editCustomDuration)) || parseFloat(editCustomDuration) <= 0) {
            showModal("Validation Error", "Please enter a valid custom duration in hours greater than zero for the edited entry.");
            return;
        }
        actualEditDurationMinutes = parseFloat(editCustomDuration) * 60; // Convert hours to minutes
    } else {
        actualEditDurationMinutes = editDuration; // This is already a number from DURATION_OPTIONS (in minutes)
    }

    if (editGamingOption === 'Custom Price' && (editCustomGamingPrice === '' || isNaN(parseFloat(editCustomGamingPrice)) || parseFloat(editCustomGamingPrice) <= 0)) {
        showModal("Validation Error", "Please enter a valid custom hourly price greater than zero for the edited entry.");
        return;
    }

    setIsSubmitting(true);
    try {
      // Calculate the new outTime based on original entryTime and new editDuration
      const updatedOutTime = calculateOutTime(currentEditEntry.entryTime, actualEditDurationMinutes);
      const updatedTotalHours = calculateTotalHours(actualEditDurationMinutes);
	  const updatedGamingPrice = calculateGamingSessionPrice(editGamingOption, updatedTotalHours, editCustomGamingPrice, editApplyDiscount);
      const updatedBeveragePrice = calculateEntryBeveragePricing(editSelectedBeverages);
      const updatedTotalBill = updatedGamingPrice + updatedBeveragePrice;
	
	  const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id'; // Use env var
      const entryRef = doc(db, `artifacts/${appId}/public/data/entries`, currentEditEntry.id);
      
      const updateData = {
        gamingOption: editGamingOption,
        outTime: updatedOutTime, // Store the newly calculated outTime
        durationMinutes: actualEditDurationMinutes, // Store the updated actual duration in minutes
        totalHours: updatedTotalHours,
        gamingPricing: updatedGamingPrice,
        beverages: editSelectedBeverages,
        beveragePricing: updatedBeveragePrice,
        totalBill: updatedTotalBill,
        paymentMethod: editPaymentMethod,
		isDiscountApplied: editApplyDiscount,
        timestamp: serverTimestamp(),
      };

      if (editGamingOption === 'Custom Price') {
        updateData.customHourlyRate = parseFloat(editCustomGamingPrice);
      } else {
        updateData.customHourlyRate = deleteField();
      }

      await updateDoc(entryRef, updateData);

      showModal("Success", "Entry updated successfully!");
      handleCloseEditModal();
      console.log("Entry updated successfully.");
    } catch (e) {
      console.error("Error updating document: ", e);
      showModal("Error", "Failed to update entry. Please check console for details.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Function to export ALL entries to CSV
  const handleExportToCsv = async (dateToExport = null) => {
    if (!db) {
      showModal("Error", "Database not initialized.");
      return;
    }

    setExporting(true);
    try {
      const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id'; // Use env var
      const entriesColRef = collection(db, `artifacts/${appId}/public/data/entries`);
      
	  let querySnapshot;
      let filenameDatePart;

      if (dateToExport) {
        // Query for entries of a specific date
        const q = query(entriesColRef, where("date", "==", dateToExport));
        querySnapshot = await getDocs(q);
        filenameDatePart = dateToExport;
        console.log(`Attempting to export entries for date: ${dateToExport}`);
      } else {
        // Query for all entries - THIS PATH IS NO LONGER USED FOR "Export All Data" button
        querySnapshot = await getDocs(entriesColRef);
        filenameDatePart = new Date().toISOString().slice(0, 10);
        console.log("Attempting to export all entries.");
      }

      const allData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Sort the data by entryTime
      allData.sort((a, b) => {
          // Helper to convert "HH:MM" to total minutes from midnight for comparison
          const timeToMinutes = (timeStr) => {
              if (!timeStr) return 0; // Handle cases where entryTime might be missing
              const [hours, minutes] = timeStr.split(':').map(Number);
              return hours * 60 + minutes;
          };

          const entryMinutesA = timeToMinutes(a.entryTime);
          const entryMinutesB = timeToMinutes(b.entryTime);

          // For entries on the same date, sort by entry time
          if (a.date === b.date) {
              return entryMinutesA - entryMinutesB;
          } else {
              // If dates are different, sort by date first, then by entry time
              const dateA = new Date(a.date).getTime();
              const dateB = new Date(b.date).getTime();
              return dateA - dateB;
          }
      });

      if (allData.length === 0) {
        if (dateToExport) {
          showModal("No Data", `No entries found for ${formatDateToDDMMYYYY(dateToExport)} to export.`);
        } else {
          showModal("No Data", "There are no entries to export in the database.");
        }
        setExporting(false);
        return;
      }

      const headers = [
        "Serial Number", "Date", "Name", "Mobile Number", "Gaming Option", "Station No.",
        "Entry Time", "Out Time", "Duration (min)", "Total Hours", "Remaining Time", // Added Duration (min)
        "Hourly Rate (₹)",
        "Gaming Price (₹)", "F&B", "F&B Price (₹)", "Total Bill (₹)", "Payment Method"
      ];

      const csvRows = [
        headers.map(header => `"${header.replace(/"/g, '""')}"`).join(',')
      ];

      allData.forEach(entry => {
        const { display: remainingTimeDisplayForExport } = calculateRemainingTimeAndStatus(entry, entry.outTime, new Date()); 

        const hourlyRateForExport = entry.gamingOption === 'Custom Price'
          ? (entry.customHourlyRate || 0).toFixed(2)
          : (GAMING_HOURLY_PRICES[entry.gamingOption] || 0).toFixed(2);


        const getBeverageNameFromKey = (key) => {
          // Use SORTED_FIXED_BEVERAGE_PRICES for lookup
          if (SORTED_FIXED_BEVERAGE_PRICES[key] !== undefined) {
            return key;
          } else {
            const bev = beverages.find(b => b.id === key);
            return bev ? bev.name : 'Unknown Beverage';
          }
        };

        const rowData = [
          entry.serialNumber,
          new Date(entry.date).toLocaleDateString('en-GB'),
          entry.name,
          entry.mobileNumber,
          entry.gamingOption,
		  entry.stationNumber || 'N/A',
          formatTimeTo12Hr(entry.entryTime),
          formatTimeTo12Hr(entry.outTime),
          entry.durationMinutes, // Added actual duration in minutes
          entry.totalHours?.toFixed(2),
          remainingTimeDisplayForExport,
          hourlyRateForExport,
          entry.gamingPricing?.toFixed(2),
          entry.beverages && Object.keys(entry.beverages).length > 0
            ? Object.entries(entry.beverages)
                .map(([bevKey, qty]) => {
                  const bevName = getBeverageNameFromKey(bevKey);
                  return bevName ? `${bevName} (x${qty})` : null;
                })
                .filter(Boolean)
                .join('; ')
            : 'None',
          entry.beveragePricing?.toFixed(2),
          entry.totalBill?.toFixed(2),
          entry.paymentMethod,
        ];
        csvRows.push(rowData.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','));
      });

      const csvString = csvRows.join('\n');
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Fun4You_Entries_${filenameDatePart}.csv`);
      link.click();
      URL.revokeObjectURL(url);
      
      if (dateToExport) {
        showModal("Export Complete", `Data for ${formatDateToDDMMYYYY(dateToExport)} has been exported to CSV.`);
        console.log(`Data for ${dateToExport} exported to CSV.`);
      } else {
        showModal("Export Complete", "All historical data has been exported to CSV successfully!");
        console.log("All data exported to CSV.");
      }
      
    } catch (e) {
      console.error("Error exporting data: ", e);
      showModal("Error", "Failed to export data. Please check console for details.");
    } finally {
      setExporting(false);
    }
  };

  // Effect for automatic daily CSV export
  useEffect(() => {
    const checkAutoExport = () => {
      const now = new Date();
      const currentDayISO = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const targetHour = 23; // 11 PM
      const targetMinute = 59; // 59 minutes

      // Check if it's the target time and hasn't been exported today
      if (now.getHours() === targetHour && 
          now.getMinutes() === targetMinute && 
          now.getSeconds() >= 0 && now.getSeconds() <= 59 && // Check within the entire minute
          lastAutoExportDate !== currentDayISO) {
        
        console.log(`Attempting automatic CSV export for ${currentDayISO}...`);
        handleExportToCsv(currentDayISO);
        localStorage.setItem('lastAutoExportDate', currentDayISO);
        setLastAutoExportDate(currentDayISO); // Update state to prevent re-trigger until next day
      }
    };

    // Run check every minute to be accurate with 11:59 PM
    const interval = setInterval(checkAutoExport, 60 * 1000); // Check every minute

    // Clean up interval on component unmount
    return () => clearInterval(interval);
  }, [lastAutoExportDate, db]); // Dependencies: lastAutoExportDate to re-check when it updates, db for handleExportToCsv

  // Function to handle password submission for total collection
  const handleVerifyPassword = () => {
    if (adminPassword === currentAdminPassword) { // Use currentAdminPassword
      setShowTotalCollection(true);
      setPasswordError('');
      console.log("Admin password verified. Showing total collection.");
    } else {
      setPasswordError('Incorrect password. Please try again.');
      setShowTotalCollection(false);
      console.warn("Incorrect admin password entered.");
    }
  };

  // Function to capitalize the first letter of a string
  const capitalizeFirstLetter = (string) => {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
  };

  // Helper to parse time slot string (e.g., "10:00 AM - 11:00 AM") to a Date object representing the start time on the current day
  const parseTimeSlotStart = (timeSlotString, dateString) => {
    const [startTimeStr] = timeSlotString.split(' - ');
    const [time, ampm] = startTimeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (ampm === 'PM' && hours !== 12) {
      hours += 12;
    }
    if (ampm === 'AM' && hours === 12) { // Midnight (12 AM) case should be 0 hours
      hours = 0;
    }

    const bookingDateObj = new Date(`${dateString}T00:00:00`); // Start of the booking day
    const bookingDateTime = new Date(
        bookingDateObj.getFullYear(),
        bookingDateObj.getMonth(),
        bookingDateObj.getDate(),
        hours, minutes, 0, 0
    );
    return bookingDateTime;
  };

  // Helper function to format a YYYY-MM-DD date string to DD:MM:YYYY
  const formatDateToDDMMYYYY = (dateString) => {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return `${day}:${month}:${year}`;
  };

  // Handle Advance Booking Submission
  const handleAddAdvanceBooking = async (e) => {
    e.preventDefault();
    if (!db || !userId) {
      showModal("Authentication Error", "Firebase not initialized or user not authenticated.");
      return;
    }

    if (!advanceBookingName || !advanceBookingMobile || !numPlayers || !timeSlot) {
      showModal("Validation Error", "Please fill in all advance booking fields.");
      return;
    }
    if (dynamicTimeSlots.length === 0) {
      showModal("Validation Error", "No time slots available for booking. Please check available times.");
      return;
    }


    const mobileRegex = /^\d{10}$/;
    if (!mobileRegex.test(advanceBookingMobile)) {
      showModal("Validation Error", "Mobile Number must contain exactly 10 numeric digits.");
      return;
    }

    // NEW VALIDATION: Check if booking is for today and in the past
    const now = currentTime; // Use the live current time
    const bookingStartDateTime = parseTimeSlotStart(timeSlot, selectedBookingDate);

    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    if (selectedBookingDate === todayISO && bookingStartDateTime.getTime() < now.getTime()) {
        showModal("Invalid Booking Time", "You cannot book a slot in the past for today's date. Please select a future time slot.");
        return; // Prevent form submission
    }
    try {

      const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id'; // Use env var

      const bookingData = {
        name: advanceBookingName,
        mobileNumber: advanceBookingMobile,
        numPlayers: numPlayers,
		gamingOption: advanceBookingGamingOption,
        timeSlot: timeSlot,
        bookingDate: selectedBookingDate, // Store the date the booking is for
        timestamp: serverTimestamp(), // Timestamp of creation
      };

      await addDoc(collection(db, `artifacts/${appId}/public/data/advanceBookings`), bookingData);

      // NEW: Update or add customer details for advance booking
      const customersColRef = collection(db, `artifacts/${appId}/public/data/customers`);
      const q = query(customersColRef, where("mobileNumber", "==", advanceBookingMobile));
      const customerSnapshot = await getDocs(q);

      if (customerSnapshot.empty) {
        // Customer does not exist, add new customer
        await addDoc(customersColRef, {
          name: advanceBookingName,
          mobileNumber: advanceBookingMobile,
          lastVisited: serverTimestamp(), // Mark as last visited on booking
        });
        console.log("New customer added from advance booking.");
      } else {
        // Customer exists, update last visited timestamp and name (in case it changed)
        const customerDoc = customerSnapshot.docs[0];
        await updateDoc(doc(db, `artifacts/${appId}/public/data/customers`, customerDoc.id), {
          name: advanceBookingName, // Update name in case it was changed
          lastVisited: serverTimestamp(),
        });
        console.log("Existing customer updated from advance booking.");
      }


      setAdvanceBookingName('');
      setAdvanceBookingMobile(''); 
      setNumPlayers(1);
      setTimeSlot(dynamicTimeSlots[0] || ''); 

      showModal("Advance Booking Confirmed", "Your advance booking has been added successfully!");
      console.log("Advance booking added to Firebase.");
    } catch (e) {
      console.error("Error adding advance booking: ", e);
      showModal("Error", "Failed to add advance booking. Please try again.");
    }
  };

  // Handle Edit Advance Booking Click
  const handleEditAdvanceBookingClick = (booking) => {
    setIsEditingAdvanceBooking(true);
    setCurrentEditAdvanceBooking(booking);
    setEditAdvanceBookingName(booking.name);
    setEditAdvanceBookingMobile(booking.mobileNumber);
    setEditNumPlayers(booking.numPlayers);
	setEditAdvanceBookingGamingOption(booking.gamingOption || 'PC'); // <-- ADD THIS LINE
    setEditTimeSlot(booking.timeSlot);
    setEditSelectedBookingDate(booking.bookingDate);
  };

  // Handle Update Advance Booking Submission
  const handleUpdateAdvanceBooking = async (e) => {
    e.preventDefault();
    if (!db || !currentEditAdvanceBooking) {
      showModal("Error", "No advance booking selected for editing.");
      return;
    }

    if (!editAdvanceBookingName || !editAdvanceBookingMobile || !editNumPlayers || !editTimeSlot) {
      showModal("Validation Error", "Please fill in all advance booking fields.");
      return;
    }

    const mobileRegex = /^\d{10}$/;
    if (!mobileRegex.test(editAdvanceBookingMobile)) {
      showModal("Validation Error", "Mobile Number must contain exactly 10 numeric digits.");
      return;
    }

    const now = currentTime;
    const bookingStartDateTime = parseTimeSlotStart(editTimeSlot, editSelectedBookingDate);

    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    if (editSelectedBookingDate === todayISO && bookingStartDateTime.getTime() < now.getTime()) {
        showModal("Invalid Booking Time", "You cannot book a slot in the past for today's date. Please select a future time slot.");
        return;
    }

    try {
      const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
      const bookingRef = doc(db, `artifacts/${appId}/public/data/advanceBookings`, currentEditAdvanceBooking.id);
      
      const updateData = {
        name: editAdvanceBookingName,
        mobileNumber: editAdvanceBookingMobile,
        numPlayers: editNumPlayers,
		gamingOption: editAdvanceBookingGamingOption,
        timeSlot: editTimeSlot,
        bookingDate: editSelectedBookingDate,
        timestamp: serverTimestamp(),
      };

      await updateDoc(bookingRef, updateData);

      // NEW: Update customer details in customer management
      const customersColRef = collection(db, `artifacts/${appId}/public/data/customers`);
      const q = query(customersColRef, where("mobileNumber", "==", editAdvanceBookingMobile));
      const customerSnapshot = await getDocs(q);

      if (customerSnapshot.empty) {
        // If mobile number changed and new number doesn't exist, add as a new customer
        await addDoc(customersColRef, {
          name: editAdvanceBookingName,
          mobileNumber: editAdvanceBookingMobile,
          lastVisited: serverTimestamp(), // Mark as last visited on booking
        });
        console.log("New customer created due to mobile number change in advance booking edit.");
      } else {
        // If customer exists with this mobile number, update their name and last visited
        const customerDoc = customerSnapshot.docs[0];
        await updateDoc(doc(db, `artifacts/${appId}/public/data/customers`, customerDoc.id), {
          name: editAdvanceBookingName,
          lastVisited: serverTimestamp(),
        });
        console.log("Existing customer updated from advance booking edit.");
      }

      showModal("Success", "Advance booking updated successfully!");
      setIsEditingAdvanceBooking(false);
      setCurrentEditAdvanceBooking(null);
      console.log("Advance booking updated successfully.");
    } catch (e) {
      console.error("Error updating advance booking: ", e);
      showModal("Error", "Failed to update advance booking. Please try again.");
    }
  };


  // Handle Delete Advance Booking
  const handleDeleteAdvanceBooking = (id, name) => {
    showModal("Confirm Deletion", `Are you sure you want to delete the advance booking for "${name}"?`, 'confirm', async () => {
      if (!db) {
        showModal("Error", "Database not initialized.");
        return;
      }
      try {
		const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id'; // Use env var
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/advanceBookings`, id));
        showModal("Deleted", `Advance booking for "${name}" has been deleted.`, 'alert');
        notifiedBookingIds.current.delete(id); // Also remove from notified list
        console.log(`Advance booking for ${name} deleted from Firebase.`);
      } catch (e) {
        console.error("Error deleting advance booking: ", e);
        showModal("Error", `Failed to delete advance booking for "${name}". Please try again.`);
      }
    });
  };
  
 // NEW: Effect to dynamically generate time slots for the edit modal
  useEffect(() => {
    // Only generate if the edit modal is open and currentEditAdvanceBooking is available
    if (isEditingAdvanceBooking && currentEditAdvanceBooking) {
        const generatedSlots = generateTimeSlots(editSelectedBookingDate, currentTime);
        setDynamicTimeSlotsForEdit(generatedSlots);
        // Ensure the editTimeSlot is still valid or pick the first available
        if (editTimeSlot === '' || !generatedSlots.includes(editTimeSlot)) {
            if (generatedSlots.length > 0) {
                setEditTimeSlot(generatedSlots[0]);
            } else {
                setEditTimeSlot('');
            }
        }
    }
}, [currentTime, editSelectedBookingDate, isEditingAdvanceBooking, currentEditAdvanceBooking, editTimeSlot]);
 

  // Handlers for the new display filter checkboxes
  const handleShowAllTodayChange = (e) => {
    const isChecked = e.target.checked;
    setShowAllTodayEntries(isChecked);
    if (isChecked) {
      setShowCurrentActiveEntries(false);
    } else {
      setShowCurrentActiveEntries(true);
    }
  };

  const handleShowCurrentActiveChange = (e) => {
    const isChecked = e.target.checked;
    setShowCurrentActiveEntries(isChecked);
    if (isChecked) {
      setShowAllTodayEntries(false);
    } else {
      setShowAllTodayEntries(true);
    }
  };

  // Handler for clicking the delete button in the table
  const handleDeleteEntryClick = (entry) => {
    setDeleteEntryId(entry.id);
    setDeleteEntryName(entry.name);
    setDeletePassword('');
    setDeletePasswordError('');
    setShowDeleteConfirmModal(true);
  };

  // Handler for submitting the password in the delete modal
  const handleConfirmDeleteEntry = async () => {
    if (deletePassword === currentAdminPassword) { // Use currentAdminPassword
      if (!db || !deleteEntryId) {
        showModal("Error", "Database not initialized or no entry selected for deletion.");
        return;
      }
      setIsDeleting(true);
      try {
        const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id'; // Use env var
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/entries`, deleteEntryId));
        setShowDeleteConfirmModal(false);
        showModal("Success", `Entry for ${deleteEntryName} deleted successfully.`);
        notifiedEntryIds.current.delete(deleteEntryId);
		setSelectedEntryIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(deleteEntryId);
            return newSet;
        });
        console.log(`Entry for ${deleteEntryName} deleted successfully.`);
      } catch (e) {
        console.error("Error deleting document: ", e);
        showModal("Error", `Failed to delete entry for ${deleteEntryName}. Please check console for details.`);
      } finally {
        setIsDeleting(false);
      }
    } else {
      setDeletePasswordError('Incorrect password. Please try again.');
      console.warn("Incorrect delete password entered for entry:", deleteEntryName);
    }
  };

  // NEW: Handle changing admin password
  const handleChangeAdminPassword = async () => {
    if (!db) {
      setChangePasswordError("Database not initialized.");
      return;
    }
    if (oldPasswordInput !== currentAdminPassword) { // Compare against currentAdminPassword
      setChangePasswordError("Incorrect current password.");
      return;
    }
    if (newPasswordInput.length < 6) {
      setChangePasswordError("New password must be at least 6 characters long.");
      return;
    }
    if (newPasswordInput !== confirmNewPasswordInput) {
      setChangePasswordError("New password and confirmation do not match.");
      return;
    }

    try {
      await setDoc(adminPasswordDocRef.current, { adminPassword: newPasswordInput }, { merge: true });
      setCurrentAdminPassword(newPasswordInput); // Update local state immediately
      setShowChangePasswordModal(false);
      setNewOldPasswordInput('');
      setNewPasswordInput('');
      setConfirmNewPasswordInput('');
      setChangePasswordError('');
      showModal("Success", "Admin password changed successfully!");
      console.log("Admin password changed successfully.");
    } catch (e) {
      console.error("Error updating admin password:", e);
      setChangePasswordError("Failed to update password. Please try again.");
    }
  };

  // Effect for advance booking reminders
  useEffect(() => {
    // Clear any existing reminder timers to avoid multiple notifications
    if (bookingReminderTimerRef.current) {
      clearTimeout(bookingReminderTimerRef.current);
      bookingReminderTimerRef.current = null;
    }

    const now = currentTime; // Use the continuously updated current time for live checks

    const upcomingBooking = advanceBookings.find(booking => {
	  const bookingDateTime = parseTimeSlotStart(booking.timeSlot, booking.bookingDate);      
      const reminderTime = new Date(bookingDateTime.getTime() - 15 * 60 * 1000); // 15 minutes before slot starts
      const endTime = new Date(bookingDateTime.getTime() + 60 * 60 * 1000); // Assuming 1 hour slot for reminders

      // A booking qualifies for reminder if:
      // 1. Current time is past or at the reminder time.
      // 2. Current time is before or at the end of the slot (to avoid reminding for very old slots).
      // 3. The reminder hasn't already been shown for this specific booking.
      const isWithinReminderWindow = now.getTime() >= reminderTime.getTime() && now.getTime() <= endTime.getTime();
      const hasNotBeenNotified = !notifiedBookingIds.current.has(booking.id);

      return isWithinReminderWindow && hasNotBeenNotified;
    });

    if (upcomingBooking) {
      setCurrentBookingReminder(upcomingBooking);
      setShowAdvanceBookingReminder(true);
      notifiedBookingIds.current.add(upcomingBooking.id); // Mark this booking as notified

      // Set a timer to automatically dismiss the reminder after a duration
      bookingReminderTimerRef.current = setTimeout(() => {
        setShowAdvanceBookingReminder(false);
        setCurrentBookingReminder(null);
      }, 20000); // Show reminder for 20 seconds
    }

    // Cleanup function: clear the timer if component unmounts or dependencies change
    return () => {
      if (bookingReminderTimerRef.current) {
        clearTimeout(bookingReminderTimerRef.current);
      }
    };
  }, [advanceBookings, currentTime]); // Re-run when advance bookings data or current time updates

  // Function to manually dismiss the advance booking reminder
  const handleDismissAdvanceBookingReminder = () => {
    if (bookingReminderTimerRef.current) {
      clearTimeout(bookingReminderTimerRef.current);
      bookingReminderTimerRef.current = null;
    }
    setShowAdvanceBookingReminder(false);
    setCurrentBookingReminder(null);
  };

  // Helper function to get color based on percentage
  const getColorForPercentage = (percent) => {
    // Define key colors in RGB for darker shades
    const greenColor = [22, 139, 66]; // Darker green, similar to green-700
    const yellowColor = [212, 163, 0]; // Darker yellow, similar to amber-700 or yellow-700
    const redColor = [185, 28, 28]; // Darker red, similar to red-800

    let r, g, b;

    if (percent > 50) {
      // Transition from yellowColor (at 50%) to greenColor (at 100%)
      const factor = (percent - 50) / 50; // Ranges from 0 (at 50%) to 1 (at 100%)
      r = Math.floor(yellowColor[0] + (greenColor[0] - yellowColor[0]) * factor);
      g = Math.floor(yellowColor[1] + (greenColor[1] - yellowColor[1]) * factor);
      b = Math.floor(yellowColor[2] + (greenColor[2] - yellowColor[2]) * factor);
    } else {
      // Transition from redColor (at 0%) to yellowColor (at 50%)
      const factor = percent / 50; // Ranges from 0 (at 0%) to 1 (at 50%)
      r = Math.floor(redColor[0] + (yellowColor[0] - redColor[0]) * factor);
      g = Math.floor(redColor[1] + (yellowColor[1] - redColor[1]) * factor);
      b = Math.floor(redColor[2] + (yellowColor[2] - redColor[2]) * factor);
    }
    return `rgb(${r},${g},${b})`;
  };

  // Handle opening the beverage details modal
  const handleOpenBeverageDetails = (beveragesData, entryName) => {
    setBeveragesForDetails(beveragesData);
    setSelectedEntryNameForBeverages(entryName);
    setShowBeverageDetailsModal(true);
  };

  // Handle closing the beverage details modal
  const handleCloseBeverageDetailsModal = () => {
    setShowBeverageDetailsModal(false);
    setBeveragesForDetails({});
    setSelectedEntryNameForBeverages('');
  };

  // Function to handle column visibility toggle
  const handleColumnToggle = (columnKey) => {
    setColumnVisibility(prev => ({
      ...prev,
      [columnKey]: !prev[columnKey]
    }));
  };

  // Define column headers and their keys for mapping to visibility state
  const columnHeaders = [
    { key: 'selectEntry', label: 'Select' },
    { key: 'serialNumber', label: 'S.No.' },
    { key: 'date', label: 'Date' },
    { key: 'name', label: 'Name' },
    { key: 'mobileNumber', label: 'Mobile' },
    { key: 'gamingOption', label: 'Gaming Opt.' },
    { key: 'stationNumber', label: 'Station No.' }, // NEW: Station Number column	
    { key: 'entryTime', label: 'Entry Time' },
    { key: 'outTime', label: 'Out Time' },
    { key: 'totalHours', label: 'Total Hours' },
    { key: 'remainingTime', label: 'Remaining Time ⏰' },
    { key: 'hourlyRate', label: 'Hourly Rate (₹)' },
    { key: 'gamingPricing', label: 'Gaming Price (₹)' },
    { key: 'beverages', label: 'F & B' },
    { key: 'beveragePricing', label: 'F & B Price (₹)' },
    { key: 'totalBill', label: 'Total Bill (₹)' },
    { key: 'paymentMethod', label: 'Payment Method' },
    { key: 'actions', label: 'Actions' }, // Actions column is always visible
  ];

  // NEW: Customer Management Functions
  const handleAddCustomer = async (e) => {
    e.preventDefault();
    if (!db) return;

    if (!newCustomerName || !newCustomerMobile) {
      showModal("Validation Error", "Please enter both name and mobile number for the new customer.");
      return;
    }

    const mobileRegex = /^\d{10}$/;
    if (!mobileRegex.test(newCustomerMobile)) {
      showModal("Validation Error", "Mobile Number must contain exactly 10 numeric digits.");
      return;
    }

    // Check for existing customer by mobile number
    const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
    const customersColRef = collection(db, `artifacts/${appId}/public/data/customers`);
    const q = query(customersColRef, where("mobileNumber", "==", newCustomerMobile));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      showModal("Duplicate Entry", "A customer with this mobile number already exists.");
      return;
    }

    try {
      await addDoc(customersColRef, {
        name: newCustomerName,
        mobileNumber: newCustomerMobile,
        lastVisited: serverTimestamp(),
      });
      setNewCustomerName('');
      setNewCustomerMobile('');
      showModal("Success", "New customer added successfully!");
    } catch (e) {
      console.error("Error adding customer: ", e);
      showModal("Error", "Failed to add customer. Please try again.");
    }
  };

  const handleEditCustomerClick = (customer) => {
    setIsEditingCustomer(true);
    setCurrentEditCustomer(customer);
    setEditCustomerName(customer.name);
    setEditCustomerMobile(customer.mobileNumber);
  };

  const handleUpdateCustomer = async (e) => {
    e.preventDefault();
    if (!db || !currentEditCustomer) return;

    if (!editCustomerName || !editCustomerMobile) {
      showModal("Validation Error", "Please enter both name and mobile number.");
      return;
    }

    const mobileRegex = /^\d{10}$/;
    if (!mobileRegex.test(editCustomerMobile)) {
      showModal("Validation Error", "Mobile Number must contain exactly 10 numeric digits.");
      return;
    }

    // Check for mobile number uniqueness, excluding the current customer being edited
    const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
    const customersColRef = collection(db, `artifacts/${appId}/public/data/customers`);
    const q = query(customersColRef, where("mobileNumber", "==", editCustomerMobile));
    const querySnapshot = await getDocs(q);

    const isDuplicate = querySnapshot.docs.some(doc => doc.id !== currentEditCustomer.id);

    if (isDuplicate) {
      showModal("Duplicate Entry", "A customer with this mobile number already exists.");
      return;
    }

    try {
      const customerRef = doc(db, `artifacts/${appId}/public/data/customers`, currentEditCustomer.id);
      await updateDoc(customerRef, {
        name: editCustomerName,
        mobileNumber: editCustomerMobile,
        lastVisited: serverTimestamp(), // Update last visited on edit too
      });
      setIsEditingCustomer(false);
      setCurrentEditCustomer(null);
      showModal("Success", "Customer updated successfully!");
    } catch (e) {
      console.error("Error updating customer: ", e);
      showModal("Error", "Failed to update customer. Please try again.");
    }
  };

  const handleDeleteCustomerClick = (customer) => {
    setDeleteCustomerId(customer.id);
    setDeleteCustomerName(customer.name);
    setShowDeleteCustomerConfirmModal(true);
  };

  const handleConfirmDeleteCustomer = async () => {
    if (!db || !deleteCustomerId) return;
    try {
      const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
      await deleteDoc(doc(db, `artifacts/${appId}/public/data/customers`, deleteCustomerId));
      setShowDeleteCustomerConfirmModal(false);
      showModal("Success", `Customer ${deleteCustomerName} deleted successfully.`);
    } catch (e) {
      console.error("Error deleting customer: ", e);
      showModal("Error", `Failed to delete customer ${deleteCustomerName}. Please try again.`);
    }
  };

  // Debounce function for search input
  const debounce = (func, delay) => {
    let timeout;
    return function(...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), delay);
    };
  };

  // Debounced search for customer suggestions
  const searchCustomersDebounced = useMemo(() => debounce(async (searchTerm, setTargetSuggestions, setTargetShowSuggestions) => {
    if (!db || !searchTerm) {
      setTargetSuggestions([]);
      setTargetShowSuggestions(false);
      return;
    }
    const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
    const customersColRef = collection(db, `artifacts/${appId}/public/data/customers`);
    let q;

    if (searchTerm.match(/^\d{10}$/)) { // If it looks like a mobile number, search by exact mobile
      q = query(customersColRef, where("mobileNumber", "==", searchTerm));
    } else { // Otherwise, search by name (case-insensitive, startsWith-like)
      const lowerSearchTerm = searchTerm.toLowerCase();
      q = query(
        customersColRef,
        where("name", ">=", capitalizeFirstLetter(lowerSearchTerm)), // For case-insensitive startsWith
        where("name", "<=", capitalizeFirstLetter(lowerSearchTerm) + '\uf8ff')
      );
    }
    
    try {
      const querySnapshot = await getDocs(q);
      const suggestions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTargetSuggestions(suggestions);
      setTargetShowSuggestions(true);
    } catch (e) {
      console.error("Error fetching customer suggestions:", e);
      setTargetSuggestions([]);
      setTargetShowSuggestions(false);
    }
  }, 300), [db]); // Debounce by 300ms

  const handleNameInputChange = (e) => {
    const value = capitalizeFirstLetter(e.target.value);
    setName(value);
    if (value.length > 1) {
      searchCustomersDebounced(value, setCustomerSuggestions, setShowCustomerSuggestions);
    } else {
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
    }
  };

  const handleMobileInputChange = (e) => {
    const value = e.target.value;
    setMobileNumber(value);
    if (value.length === 10) { // Only search when 10 digits are entered
      searchCustomersDebounced(value, setCustomerSuggestions, setShowCustomerSuggestions);
	  fetchLastNoteForCustomer(value);
    } else {
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
	  setPreviousNoteInfo(null);
    }
  };

  const handleSelectCustomer = (customer) => {
    setName(customer.name);
    setMobileNumber(customer.mobileNumber);
    setCustomerSuggestions([]);
    setShowCustomerSuggestions(false);
	fetchLastNoteForCustomer(customer.mobileNumber);
  };

  // NEW: Search and select for Advance Booking name/mobile
  const [advanceBookingCustomerSuggestions, setAdvanceBookingCustomerSuggestions] = useState([]);
  const [showAdvanceBookingCustomerSuggestions, setShowAdvanceBookingCustomerSuggestions] = useState(false);

  const handleAdvanceBookingNameInputChange = (e) => {
    const value = capitalizeFirstLetter(e.target.value);
    setAdvanceBookingName(value);
    if (value.length > 1) {
      searchCustomersDebounced(value, setAdvanceBookingCustomerSuggestions, setShowAdvanceBookingCustomerSuggestions);
    } else {
      setAdvanceBookingCustomerSuggestions([]);
      setShowAdvanceBookingCustomerSuggestions(false);
    }
  };

  const handleAdvanceBookingMobileInputChange = (e) => {
    const value = e.target.value;
    setAdvanceBookingMobile(value);
    if (value.length === 10) {
      searchCustomersDebounced(value, setAdvanceBookingCustomerSuggestions, setShowAdvanceBookingCustomerSuggestions);
    } else {
      setAdvanceBookingCustomerSuggestions([]);
      setShowAdvanceBookingCustomerSuggestions(false);
    }
  };

  const handleSelectCustomerForBooking = (customer) => {
    setAdvanceBookingName(customer.name);
    setAdvanceBookingMobile(customer.mobileNumber);
    setAdvanceBookingCustomerSuggestions([]);
    setShowAdvanceBookingCustomerSuggestions(false);
  };


  // NEW: Handle password submission for customer management tab
  const handleVerifyCustomerManagementPassword = () => {
    if (customerManagementPassword === currentAdminPassword) {
      setShowCustomerManagementContent(true);
      setCustomerManagementPasswordError('');
      console.log("Player Management password verified.");
    } else {
      setCustomerManagementPasswordError('Incorrect password. Please try again.');
      setShowCustomerManagementContent(false);
      console.warn("Incorrect Player management password entered.");
    }
  };

  // NEW: Reset customer management password state when tab changes
  useEffect(() => {
    if (activeTab !== 'customerManagement') {
      setShowCustomerManagementContent(false);
      setCustomerManagementPassword('');
      setCustomerManagementPasswordError('');
    }
  }, [activeTab]);

// Filtered customers based on search term
  const filteredCustomers = useMemo(() => {
  if (!customerSearchTerm.trim()) return customers;
  return customers.filter(customer =>
    customer.name.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
    customer.mobileNumber.includes(customerSearchTerm)
  );
}, [customerSearchTerm, customers]);

  // Handle search input change for customer management table
  const handleCustomerSearchChange = (e) => {
    setCustomerSearchTerm(e.target.value);
  };

  // NEW: Handle checkbox change for selecting entries
  const handleEntrySelect = (entryId, isChecked) => {
    setSelectedEntryIds(prev => {
      const newSet = new Set(prev);
      if (isChecked) {
        newSet.add(entryId);
      } else {
        newSet.delete(entryId);
      }
      return newSet;
    });
  };

  // NEW: Effect to recalculate totalSelectedBill whenever selectedEntryIds or entries change
  useEffect(() => {
    let sum = 0;
    entries.forEach(entry => {
      if (selectedEntryIds.has(entry.id)) {
        sum += entry.totalBill || 0;
      }
    });
    setTotalSelectedBill(sum);
	setTotalBillKey(prevKey => prevKey + 1);
  }, [selectedEntryIds, entries, totalSelectedBill]);

  // NEW: Effect to update recently finished sessions and upcoming bookings for notification bar
  useEffect(() => {
    const now = currentTime;
    const todayISO = now.toISOString().slice(0, 10);

    // Filter recently finished sessions (e.g., sessions ended within the last 10 minutes)
    const finished = entries.filter(entry => {
      const { status } = calculateRemainingTimeAndStatus(entry, entry.outTime, now);
      const outDateTime = new Date(`${entry.date}T${entry.outTime}`);
      // Adjust outDateTime to the next day if it's earlier than entryDateTime
      if (outDateTime.getTime() < new Date(`${entry.date}T${entry.entryTime}`).getTime()) {
        outDateTime.setDate(outDateTime.getDate() + 1);
      }
      const tenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
      return status === 'time-up' && outDateTime.getTime() > tenMinutesAgo.getTime();
    }).sort((a, b) => {
        const outA = new Date(`${a.date}T${a.outTime}`);
        const outB = new Date(`${b.date}T${b.outTime}`);
         if (outA.getTime() < new Date(`${a.date}T${a.entryTime}`).getTime()) outA.setDate(outA.getDate() + 1);
         if (outB.getTime() < new Date(`${b.date}T${b.entryTime}`).getTime()) outB.setDate(outB.getDate() + 1);
        return outB.getTime() - outA.getTime(); // Sort by most recent first
    });
    setRecentlyFinishedSessions(finished);

    // Filter upcoming bookings for today (e.g., within the next 2 hours)
    const upcoming = advanceBookings.filter(booking => {
      const bookingDateTime = parseTimeSlotStart(booking.timeSlot, booking.bookingDate);
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      return booking.bookingDate === todayISO && bookingDateTime.getTime() > now.getTime() && bookingDateTime.getTime() <= twoHoursLater.getTime();
    }).sort((a, b) => {
      const timeA = parseTimeSlotStart(a.timeSlot, a.bookingDate);
      const timeB = parseTimeSlotStart(b.timeSlot, b.bookingDate);
      return timeA.getTime() - timeB.getTime(); // Sort by earliest first
    });
    setUpcomingTodaysBookings(upcoming);

  }, [entries, advanceBookings, currentTime]); // Re-run when these dependencies change

  // NEW: QR Code Implementation - Handle Generate QR Code click
  const handleGenerateQrClick = async (entry) => {
    if (!db) {
      showModal("Error", "Database not initialized.");
      return;
    }
    
    try {
      const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'default-app-id';
      const entryDocRef = doc(db, `artifacts/${appId}/public/data/entries`, entry.id);
      let qrToken = entry.redemptionToken; // Check if token already exists
      
      // If no token exists, generate one and update the document
      if (!qrToken) {
        qrToken = uuidv4();
        await updateDoc(entryDocRef, {
          redemptionToken: qrToken,
          timestamp: serverTimestamp(), // Update timestamp
        });
        console.log("New QR token generated and saved for entry:", entry.id);
      }
      
      // Set the state to display the QR modal
      setCurrentQrEntry(entry);
      setQrCodeData(qrToken); // Store only the token for QR Canvas
      // Construct the full URL here for sharing
      const renderServerUrl = "https://fun4youqr.onrender.com"; // <-- Replace with your actual Render URL
	  const redemptionUrl = `${renderServerUrl}/redeem-prompt?token=${qrToken}`;

	  setRedemptionFullUrl(redemptionUrl);
      setShowQrModal(true);
    } catch (e) {
      console.error("Error generating QR code:", e);
      showModal("Error", "Failed to generate QR code. Please try again.");
    }
  };



  // NEW: QR Code Implementation - Function to copy redemption URL to clipboard
  const copyToClipboard = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      showModal("Copied!", "QR Code data copied to clipboard."); // Changed message
    } catch (err) {
      console.error('Unable to copy to clipboard', err);
      showModal("Error", "Failed to copy QR Code data to clipboard. Please copy manually.");
    }
    document.body.removeChild(textArea);
  };


  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
        <div className={`text-xl font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Loading application...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${isDarkMode ? 'bg-red-900 text-red-300' : 'bg-red-100 text-red-700'} p-4 rounded-lg shadow-md m-4 text-center`}>
        <p className="text-xl font-bold">Error: {error.message || error.toString()}</p>
        <p className="text-sm mt-2">Please check your console for more details or contact support.</p>
      </div>
    );
  }
  
    // NEW: Conditionally render the login page or the main application
  if (!isLoggedIn) {
  return <Login auth={auth} onLoginSuccess={() => setIsLoggedIn(true)} onSignOut={handleSignOut} />;
  }


  return (
    <div className={`min-h-screen font-inter p-4 sm:p-6 lg:p-8 flex flex-col items-center transition-colors duration-500
      ${isDarkMode ? 'bg-gradient-to-br from-zinc-900 to-gray-950 text-gray-100' : 'bg-gray-100 text-gray-900'}`}>
      <style>
        {`
		/* ---- Mobile fixes ---- */
@media (max-width: 768px) {
	
	
	
  /* Fix dark mode toggle (moon icon) */
  .dark-toggle {
    position: absolute;
    right: 12px;
    top: 12px;
    transform: scale(0.9); /* shrink slightly */
  }
  .station-counter {
	font-size:11px;
  }
  .apply-discount {
	margin-bottom: 21px;
	justify-content: center;
	align-items: right;
	display: flex;
  }
  
  .tab-button1 {
    width: auto;
    min-width: unset !important;
    padding: 1px 1px;
    font-size: 14px;
    margin: 2px;  /* center align */
    display: flex;
    justify-content: center;
    align-items: center;
  }

}

        /* Keyframes for blinking effect on the cell background for "final-seconds" and "time-up" status */
        @keyframes blinkingBg {
          0%, 100% { background-color: rgba(139, 0, 0, 0.7); } /* Darker red for light mode blinking */
          50% { background-color: transparent; }
        }
        /* Dark mode blinking for "final-seconds" and "time-up" status */
        @keyframes blinkingBgDark {
          0%, 100% { background-color: rgba(139, 0, 0, 0.6); } /* Darker red for dark mode blinking */
          50% { background-color: transparent; }
        }

        .blinking-bg {
          animation: blinkingBg 0.8s step-end infinite; /* Faster blink for urgency */
        }

        .dark-mode-blinking-bg {
          animation: blinkingBgDark 0.8s step-end infinite; /* Faster blink for urgency */
        }
        
        /* Base styles for the remaining time cell - Now like a health bar container */
        .remaining-time-cell {
          position: relative;
          overflow: hidden; /* Keeps fill inside the bar */
          height: 40px; /* Adjusted height for bar look */
          min-width: 150px; /* Wider for health bar effect */
          padding: 4px; /* Internal padding for the bar */
          border: 2px solid ${isDarkMode ? '#6b7280' : '#4b5563'}; /* Gray-500/700 border */
          border-radius: 8px; /* Slightly rounded corners for the bar */
          background-color: ${isDarkMode ? '#374151' : '#e5e7eb'}; /* Darker/lighter empty bar background */
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.2); /* Inner shadow for depth */
          display: flex; /* Use flex to center content */
          align-items: center;
          justify-content: center;
          /* New: Transition background for time-up effect - removed for blinking */
        }

        /* Style for the inner div that acts as the health bar fill */
        .liquid-fill {
          position: absolute;
          top: 0;
          right: 0; /* Ensures right-to-left fill */
          height: 100%; /* Fill vertically */
          width: 0%; /* Will be set dynamically by percentageRemaining */
          transition: width 0.5s ease-out, background-color 0.5s ease-out; /* Smooth transition for width and color */
          z-index: 1; /* Below text */
          border-radius: 5px; /* Slightly smaller border-radius than container */
          box-shadow: 0 0 8px rgba(255,255,255,0.2) inset; /* Subtle inner glow */
        }
        
        /* Style for the text content within the cell - now generic for positioning */
        .time-text-content {
          position: relative; /* Position relative to the parent remaining-time-cell, above liquid */
          z-index: 2; /* Above liquid */
          font-weight: 500; /* Adjusted to be lighter */
          text-align: center;
          white-space: nowrap;
          font-size: 0.85rem; /* Slightly smaller font size (as per user observation) */
        }

        .shadow-neon {
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.7),
                      0 0 20px rgba(59, 130, 246, 0.5),
                      0 0 30px rgba(139, 92, 246, 0.3);
        }
        .input-focus-ring:focus {
            --tw-ring-color: #a78bfa;
            border-color: #a78bfa;
        }
        @keyframes slideInFromTop {
          0% {
            transform: translateY(-100%);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
		@keyframes slideInFromRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
		@keyframes scaleIn {
          from {
            transform: scale(0.8);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
		.animate-fade-in {
			animation: scaleIn 0.3s ease-out forwards;
        }		
        .animate-slide-in-top {
			animation: slideInFromTop 0.5s ease-out forwards;
        }
		.animate-slide-in-right {
			animation: slideInFromRight 0.5s ease-out forwards;
        }
        /* Custom styles for tab buttons */
		.text-glow {
		  text-shadow: 0 0 5px rgba(255,255,255,0.8), 0 0 10px rgba(139, 92, 246, 0.5), 0 0 15px rgba(59, 130, 246, 0.3);
		  -webkit-text-stroke: 1px rgba(255,255,255,0.4); /* For webkit browsers */
		  paint-order: stroke fill;
		}

		/* Custom utility for neon effect on dark background */
		.text-glow-dark {
		  text-shadow: 0 0 5px rgba(170, 150, 255, 0.8), 0 0 15px rgba(139, 92, 246, 0.7), 0 0 25px rgba(59, 130, 246, 0.5);
		  -webkit-text-stroke: 1.5px rgba(255,255,255,0.5); /* Thicker for dark mode */
		}
        .tab-button {
          transition: all 0.3s ease-in-out;
          border-radius: 9999px; /* Pill shape */
          border-width: 2px; /* Explicit border for distinction */
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); /* Shadow for all buttons */
          flex-shrink: 0;
          /* Base styles for text and background, modified by conditional logic */
          background-color: transparent; /* Default for inactive */
        }
        .tab-button.active {
          background-image: linear-gradient(to right, var(--tw-gradient-stops));
          box-shadow: var(--tw-shadow);
          --tw-shadow-color: rgba(99, 102, 241, 0.5); /* Indigo for active */
          --tw-shadow: 0 4px 14px 0 var(--tw-shadow-color);
          border-color: rgba(255, 255, 255, 0.8); /* White border for active */
        }
        .tab-button.active.dark-mode {
          --tw-shadow-color: rgba(139, 92, 246, 0.5); /* Purple for active in dark mode */
          border-color: rgba(255, 255, 255, 0.8); /* White border for active in dark mode */
        }
        .tab-button.inactive.light-mode {
          border-color: #9ca3af; /* Gray-400 for inactive border in light mode */
          background-color: #e5e7eb; /* Light gray for inactive background in light mode */
          color: #4b5563; /* Gray-700 text color */
        }
        .tab-button.inactive.dark-mode {
          border-color: #52525b; /* Zinc-600 for inactive border in dark mode */
          background-color: #3f3f46; /* Zinc-700 for inactive background in dark mode */
          color: #d1d5db; /* Gray-300 text color */
        }
        .tab-button.inactive:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2), 0 4px 8px -2px rgba(0, 0, 0, 0.1); /* More pronounced hover shadow */
        }
		/* --- Hide native time input elements --- */
        /* For Chrome, Safari, Edge, Opera */
        input[type="time"]::-webkit-calendar-picker-indicator,
        input[type="time"]::-webkit-inner-spin-button,
        input[type="time"]::-webkit-clear-button {
          display: none !important;
          -webkit-appearance: none;
        }

        /* For Firefox */
        input[type="time"] {
          -moz-appearance: textfield;
        }
        /* For IE/Edge (older versions) - though mostly covered by webkit now */
        input[type="time"]::-ms-clear {
          display: none;
        }
        input[type="time"]::-ms-expand {
          display: none;
        }
        /* Autofill styles to ensure consistent appearance */
        input:-webkit-autofill,
        input:-webkit-autofill:hover, 
        input:-webkit-autofill:focus, 
        input:-webkit-autofill:active {
            -webkit-box-shadow: 0 0 0px 1000px ${isDarkMode ? '#3f3f46' : '#f9fafb'} inset !important; /* bg-zinc-700 in dark, bg-gray-50 in light */
            -webkit-text-fill-color: ${isDarkMode ? '#e5e7eb' : '#111827'} !important; /* text-gray-200 in dark, text-gray-900 in light */
            transition: background-color 5000s ease-in-out 0s; /* Prevent immediate color change */
        }
        `}
      </style>

      {/* User ID and Theme Toggle Container */}
      <div className="flex justify-between w-full max-w-6xl mb-4">

		  {/* Sign Out Button */}
		  <button
			onClick={handleSignOut}
			className={`px-4 py-2 mr-4 text-sm font-semibold rounded-full shadow-lg transition-all duration-300 ease-in-out transform hover:scale-105
			  ${isDarkMode ? 'bg-zinc-700 text-gray-200 hover:bg-zinc-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
		  >
			Sign Out
		  </button>

        {/* Theme Toggle Button */}
		<div className="dark-toggle">
        <button
          onClick={toggleTheme}
          className={`relative inline-flex items-center h-8 w-16 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2
            ${isDarkMode ? 'bg-zinc-700 focus:ring-purple-500' : 'bg-blue-400 focus:ring-blue-600'}`}
        >
          <span
            className={`transform inline-block w-6 h-6 rounded-full transition-transform duration-300
              ${isDarkMode ? 'translate-x-9 bg-purple-400' : 'translate-x-1 bg-white'} shadow-md`}
          >
            {isDarkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-zinc-800 m-auto mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500 m-auto mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h1M3 12H2m8.66-8.66l-.707-.707m-4 4L7.05 6.95M19.05 5.95l-.707.707M4.95 19.05l-.707.707" />
              </svg>
            )}
          </span>
        </button>
		</div>
      </div>


	{/* Floating Availability Icon */}
	<div className="station-counter">
		<div
			className="fixed top-20 right-0.5 bg-gradient-to-r from-purple-400 to-purple-700 text-white font-bold shadow-2xl px-2 py-1 rounded-lg cursor-pointer z-50 text-m hover:bg-blue-700 transition "
			style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
			onMouseEnter={() => setShowStationDetails(true)}
			onMouseLeave={() => setShowStationDetails(false)}
		>
			🖥️ PC: {availablePC}/{totalPC}
			<tr>🎮 PS: {availablePS}/{totalPS}</tr>
		</div>
	</div>

	{/* Station Details Popup */}
		{showStationDetails && (
		<div
			className={`fixed top-16 right-0.5 w-200 p-4 rounded-lg shadow-lg z-50 border text-sm animate-slide-in-right
			${isDarkMode ? 'bg-zinc-900 text-gray-100 border-zinc-700' : 'bg-white text-gray-900 border-gray-300'}`}
			onMouseEnter={() => setShowStationDetails(true)}
			onMouseLeave={() => setShowStationDetails(false)}
		>
		 <div className="flex flex-col md:flex-row gap-4"> {/* Changed to flex-row for horizontal layout */}
         <div className="flex-1"> {/* PC Stations Column */}
			<h3 className={`text-xl font-bold mb-4 text-center ${isDarkMode ? 'text-white-800' : 'text-black-800'}`}>PC Stations</h3>
            <div className="grid grid-cols-2 gap-4 ">
              {PC_STATIONS.map(station => {
                const isOccupied = occupiedOtherStations.has(station);
                const bgColor = isOccupied 
                  ? (isDarkMode ? 'bg-red-800' : 'bg-red-500') 
                  : (isDarkMode ? 'bg-green-800' : 'bg-green-500');
                const textColor = 'text-white';
                const shadowColor = isOccupied 
                  ? (isDarkMode ? 'shadow-red-700/30' : 'shadow-red-400/30') 
                  : (isDarkMode ? 'shadow-green-700/30' : 'shadow-green-400/30');

                return (
                  <div 
                    key={station} 
                    className={`flex flex-col items-center justify-center p-5 rounded-lg shadow-md ${bgColor} ${textColor} font-bold text-lg transition-all duration-300 ease-in-out transform hover:scale-105 ${shadowColor}`}
                  >
                    <span>{station}</span>
                    <span className="text-sm mt-1">{isOccupied ? 'Occupied' : 'Available'}</span>
                  </div>
                );
              })}
            </div>
			</div>
			<div className="flex-1"> {/* PS Stations Column */}
			<h3 className={`text-xl font-bold mb-4 text-center ${isDarkMode ? 'text-white-800' : 'text-black-800'}`}>PS Stations</h3>
            <div className="grid grid-cols-2 gap-4">
              {PS_STATIONS.map(station => {
                const occupiedSlots = occupiedPSSlots[station] || 0;
                const availableSlots = PS_STATION_CAPACITY - occupiedSlots;
                
                let bgColor, textColor, shadowColor;
                if (availableSlots === PS_STATION_CAPACITY) {
                  bgColor = isDarkMode ? 'bg-green-800' : 'bg-green-500';
                  shadowColor = isDarkMode ? 'shadow-green-700/30' : 'shadow-green-400/30';
                } else if (availableSlots > 0) {
                  bgColor = isDarkMode ? 'bg-amber-700' : 'bg-amber-500'; // Partially available
                  shadowColor = isDarkMode ? 'shadow-amber-600/30' : 'shadow-amber-400/30';
                } else {
                  bgColor = isDarkMode ? 'bg-red-800' : 'bg-red-500'; // Fully occupied
                  shadowColor = isDarkMode ? 'shadow-red-700/30' : 'shadow-red-400/30';
                }
                textColor = 'text-white';

                return (
                  <div 
                    key={station} 
                    className={`flex flex-col items-center justify-center p-3 rounded-lg shadow-md ${bgColor} ${textColor} font-bold text-lg transition-all duration-300 ease-in-out transform hover:scale-105 ${shadowColor}`}
                  >
                    <span>{station}</span>
                    <span className="text-sm text-center">
                      {occupiedSlots}/{PS_STATION_CAPACITY} slots used
                    </span>
                  </div>
                );
              })}
            </div>
			</div>
			</div>
	</div>
		)}

      {/* NEW: Floating Notification Bar */}
      {(recentlyFinishedSessions.length > 0 || upcomingTodaysBookings.length > 0) && (
        <div
          className="fixed bottom-5 right-3 bg-gradient-to-r from-red-400 to-red-700 text-white font-bold shadow-2xl px-2 py-1 rounded-full cursor-pointer z-50 text-m hover:bg-blue-700 transition "
          style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
          onMouseEnter={() => setShowNotificationPanel(true)}
          onMouseLeave={() => setShowNotificationPanel(false)}
        >
          🔔
        </div>
      )}

      {/* NEW: Notification Panel Popup */}
      {showNotificationPanel && (
        <div
          className={`fixed bottom-5 right-0.5 w-[300px] p-4 rounded-lg shadow-lg z-50 border text-sm animate-slide-in-right
            ${isDarkMode ? 'bg-zinc-900 text-gray-100 border-zinc-700' : 'bg-white text-gray-900 border-gray-300'}`}
          onMouseEnter={() => setShowNotificationPanel(true)}
          onMouseLeave={() => setShowNotificationPanel(false)}
        >
          <h3 className={`text-xl font-bold mb-4 text-center ${isDarkMode ? 'text-white-800' : 'text-black-800'}`}>Notifications</h3>
          
          {/* Recently Finished Sessions */}
          <div className="mb-4">
            <h4 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-purple-300' : 'text-blue-600'}`}>Recently Finished Sessions:</h4>
            {recentlyFinishedSessions.length > 0 ? (
              <ul className="list-disc list-inside space-y-1 text-sm">
                {recentlyFinishedSessions.map(entry => (
                  <li key={entry.id}>
                    {entry.name} ({formatTimeTo12Hr(entry.outTime)}) - ₹{entry.totalBill?.toFixed(2)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>No recent finished sessions.</p>
            )}
          </div>

          {/* Upcoming Bookings Today */}
          <div>
            <h4 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-green-300' : 'text-teal-600'}`}>Upcoming Bookings Today:</h4>
            {upcomingTodaysBookings.length > 0 ? (
              <ul className="list-disc list-inside space-y-1 text-sm">
                {upcomingTodaysBookings.map(booking => (
                  <li key={booking.id}>
                    {booking.name} ({booking.numPlayers} players) - {booking.timeSlot}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>No upcoming bookings for today.</p>
            )}
          </div>
        </div>
      )}

      {/* Header Image */}
      <h1 className="flex justify-center items-center mb-10">
        <img
          src="./images/Logo1.png"
          alt="FUN4YOU - THE CONSOLE CORNER Gaming Logo"
          className={`w-[220px] h-[220px] rounded-2xl shadow-xl transform transition-transform duration-300 ease-in-out hover:scale-105
            ${isDarkMode ? 'shadow-purple-800/30 hover:shadow-neon' : 'shadow-blue-800/30 hover:shadow-blue'}`}
          onError={(e) => { e.target.onerror = null; e.target.src = isDarkMode ? "https://placehold.co/800x200/27272a/fafafa?text=FUN4YOU+Gaming+Zone+Placeholder" : "https://placehold.co/800x200/cccccc/333333?text=FUN4YOU+Gaming+Zone+Placeholder"; }}
        />
      </h1>

      {/* Tab Navigation */}
	<div class="w-full max-w-6xl mb-6 flex flex-col sm:flex-row justify-center space-y-4 sm:space-y-0 sm:space-x-4 transition-colors duration-500">
	<div className="tab-button1">
        <button
          className={`py-2 px-4 w-35 items-center flex gap-1 text-center text-base font-bold tab-button
            ${activeTab === 'addEntry'
              ? `${isDarkMode ? 'bg-gradient-to-r from-purple-600 to-indigo-700 text-white active dark-mode' : 'bg-gradient-to-r from-blue-600 to-indigo-700 text-white active'}`
              : `${isDarkMode ? 'inactive dark-mode' : 'inactive light-mode'}`
            }`}
          onClick={() => setActiveTab('addEntry')}
        >
          Add Entry
			<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
			</svg>
        </button>
	</div>
	<div className="tab-button1">	
        <button
          className={`py-2 px-4 w-50 text-center items-center flex gap-1 text-base font-bold tab-button
            ${activeTab === 'advanceBooking'
              ? `${isDarkMode ? 'bg-gradient-to-r from-green-700 to-green-600 text-white active dark-mode' : 'bg-gradient-to-r from-green-700 to-green-600 text-white active'}`
              : `${isDarkMode ? 'inactive dark-mode' : 'inactive light-mode'}`}`
            }
          onClick={() => setActiveTab('advanceBooking')}
        >
          Advance Booking
			<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
			</svg>
        </button>
	</div>
	<div className="tab-button1">		
        <button
          className={`py-2 px-4 w-50 items-center flex gap-1 text-center text-base font-bold tab-button
            ${activeTab === 'customerManagement'
              ? `${isDarkMode ? 'bg-gradient-to-r from-teal-700 to-teal-600 text-white active dark-mode' : 'bg-gradient-to-r from-teal-700 to-teal-600 text-white active'}`
              : `${isDarkMode ? 'inactive dark-mode' : 'inactive light-mode'}`}`
            }
          onClick={() => setActiveTab('customerManagement')}
        >
          Player Management
			<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.125-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.125-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
			</svg>
        </button>
	</div>	
      </div>

      {/* Tab Content */}
      {activeTab === 'addEntry' && (
        <>
          {/* Add New Entry Form */}
          <div className={`w-full max-w-6xl p-8 rounded-2xl shadow-2xl mb-10 transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border border-purple-800 shadow-xl shadow-purple-700/30' : 'bg-white border border-blue-200 shadow-xl shadow-blue-400/30'}`}>
            <h2 className={`text-3xl font-extrabold mb-6 border-b-2 pb-4 flex gap-1 justify-center text-center transition-colors duration-500
              ${isDarkMode ? 'text-blue-400 border-purple-700' : 'text-blue-600 border-blue-300'}`}>Player Details
			<svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
			</svg>
			  </h2>
			  
			{/* Previous Note Reminder */}
            {previousNoteInfo && (
                <div className={`relative p-4 mb-6 rounded-lg border-l-4 shadow-md transition-all duration-300 ${isDarkMode ? 'bg-yellow-900 border-yellow-500 text-yellow-200' : 'bg-yellow-100 border-yellow-500 text-yellow-800'}`}>
                    <button
                        onClick={() => setPreviousNoteInfo(null)}
                        className="absolute top-2 right-2 p-1 rounded-full hover:bg-black/10"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                    <p className="font-bold">Reminder from a previous session for {previousNoteInfo.from} (on {previousNoteInfo.date}):</p>
                    <p className="mt-1">{previousNoteInfo.note}</p>
                </div>
            )}
			  
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {/* Left Column Fields */}
              <div className="order-1 md:order-none flex flex-col items-center"> {/* Added items-center for centering inputs */}
                <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width */}
                  <label htmlFor="serialNumber" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Serial Number</label>
                  <input
                    type="text"
                    id="serialNumber"
                    className={`block w-full rounded-lg shadow-sm p-3 cursor-not-allowed text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 shadow-lg shadow-blue-200/50'}`}
                    value={serialCounter + 1}
                    readOnly
                  />
                </div>
				</div>
				<div className="order-2 md:order-none flex flex-col items-center">
                <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width */}
                  <label htmlFor="date" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Date</label>
                  <input
                    type="text"
                    id="date"
                    className={`block w-full rounded-lg shadow-sm p-3 cursor-not-allowed text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 shadow-lg shadow-blue-200/50'}`}
                    value={new Date().toLocaleDateString('en-GB')}
                    readOnly
                  />
                </div>
				</div>
				<div className="order-3 md:order-none flex flex-col items-center">
                <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width and relative for suggestions */}
                  <label htmlFor="name" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Name</label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={handleNameInputChange}
                    onFocus={() => setShowCustomerSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 100)} // Delay to allow click on suggestion
                    className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                    required
                    autoComplete="off" // Disable browser autocomplete
                  />
                  {showCustomerSuggestions && customerSuggestions.length > 0 && (
                    <ul className={`absolute z-10 w-full rounded-md shadow-lg max-h-60 overflow-auto ring-1 ring-black ring-opacity-5 focus:outline-none
                      ${isDarkMode ? 'bg-zinc-700 text-gray-200' : 'bg-white text-gray-900'}`}>
                      {customerSuggestions.map((customer) => (
                        <li
                          key={customer.id}
                          onMouseDown={() => handleSelectCustomer(customer)} // Use onMouseDown to trigger before onBlur
                          className={`cursor-pointer select-none relative py-2 pl-3 pr-9 ${isDarkMode ? 'hover:bg-zinc-600' : 'hover:bg-gray-100'}`}
                        >
                          {customer.name} ({customer.mobileNumber})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
				</div>
				<div className="order-4 md:order-none flex flex-col items-center">
                <div className="w-full sm:max-w-sm relative"> {/* Added wrapper to limit input width and relative for suggestions */}
                  <label htmlFor="mobileNumber" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Mobile Number</label>
                  <input
                    type="tel"
                    id="mobileNumber"
                    value={mobileNumber}
                    onChange={handleMobileInputChange}
                    onFocus={() => setShowCustomerSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 100)} // Delay to allow click on suggestion
                    className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                    pattern="[0-9]{10}"
                    maxLength="10"
                    required
                    autoComplete="off" // Disable browser autocomplete
                  />
                  {showCustomerSuggestions && customerSuggestions.length > 0 && (
                    <ul className={`absolute z-10 w-full rounded-md shadow-lg max-h-60 overflow-auto ring-1 ring-black ring-opacity-5 focus:outline-none
                      ${isDarkMode ? 'bg-zinc-700 text-gray-200' : 'bg-white text-gray-900'}`}>
                      {customerSuggestions.map((customer) => (
                        <li
                          key={customer.id}
                          onMouseDown={() => handleSelectCustomer(customer)} // Use onMouseDown to trigger before onBlur
                          className={`cursor-pointer select-none relative py-2 pl-3 pr-9 ${isDarkMode ? 'hover:bg-zinc-600' : 'hover:bg-gray-100'}`}
                        >
                          {customer.mobileNumber} ({customer.name})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
				</div>				
				<div className="order-5 md:order-none flex flex-col items-center">
                <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width */}
				<div className="apply-discount">
				<label className="absolute md:ml-[275px] flex items-center cursor-pointer p-1">
						<input
							type="checkbox"
							checked={applyDiscount}
							onChange={(e) => setApplyDiscount(e.target.checked)}
							className="form-checkbox h-4 w-4 text-green-500 rounded"
						/>
						<span className={`ml-1 text-xs font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
							Apply Discount
						</span>
					</label>
				</div>
					{/* The main label, now centered like the other fields */}
					<label htmlFor="gamingOption" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
						Gaming Option
					</label>
					
					{/* The dropdown, styled as before */}
					<select
						id="gamingOption"
						value={gamingOption}
						onChange={(e) => {
						  setGamingOption(e.target.value);
						  if (e.target.value !== 'Custom Price') {
							setCustomGamingPrice('');
						  }
						  setStationNumber('');
						}}
						className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
						  ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
					>
						{Object.keys(GAMING_HOURLY_PRICES).map((option) => (
						  <option key={option} value={option}>{option} {option !== 'Custom Price' ? `(₹${GAMING_HOURLY_PRICES[option]}/hr)` : ''}</option>
						))}
					</select>
					{gamingOption === 'Custom Price' && (
						<input
						  type="number"
						  placeholder="Enter Custom Hourly Rate (₹)"
						  value={customGamingPrice}
						  onChange={(e) => setCustomGamingPrice(e.target.value)}
                      className={`mt-2 block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200 hover:bg-zinc-700 focus:bg-zinc-700' : 'border-gray-300 bg-gray-50 text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                      min="0"
                      step="0.01"
                      required
                    />
                  )}
                </div>
				</div>
                {(gamingOption.startsWith('PC') || gamingOption.startsWith('PS') || gamingOption === 'Racing Cockpit' || gamingOption === 'Custom Price') && (
                <div className="order-6 md:order-none flex flex-col items-center">
				<div className="w-full sm:max-w-sm">
                  <label htmlFor="stationNumber" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Station No.</label>
                  <select
                    id="stationNumber"
                    value={stationNumber}
                    onChange={(e) => setStationNumber(e.target.value)}
                    className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                    required={gamingOption.startsWith('PC') || gamingOption.startsWith('PS') || gamingOption === 'Racing Cockpit' || gamingOption === 'Custom Price'}
                  >
                    <option value="">Select Station</option>
                    {getFilteredStationOptions(gamingOption).length > 0 ? (
                      getFilteredStationOptions(gamingOption).map(station => (
                        <option key={station} value={station}>{station}</option>
                      ))
                    ) : (
                      <option value="" disabled>No stations available</option>
                    )}
                  </select>
                </div>
				</div>
                )}				
				<div className="order-7 md:order-none flex flex-col items-center">
                <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width */}
                  <label htmlFor="duration" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Duration</label>
                  <select
                    id="duration"
                    value={duration}
                    onChange={(e) => {
                      setDuration(e.target.value);
                      // Clear custom duration input if a non-custom option is selected
                      if (e.target.value !== 'custom') {
                          setCustomDuration('');
                      }
                    }}
                    className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                  >
                    {DURATION_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  {duration === 'custom' && (
                      <input
                          type="number"
                          placeholder="Enter Duration in Hours" 
                          value={customDuration}
                          onChange={(e) => setCustomDuration(e.target.value)}
                          className={`mt-2 block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                            ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                          min="1"
                          step="0.5" 
                          required
                      />
                  )}
                </div>
				</div>
				<div className="order-8 md:order-none flex flex-col items-center">
                <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width */}
                  <label htmlFor="entryTime" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Entry Time</label>
                  <input
                    type="time"
                    id="entryTime"
                    value={entryTime}
                    onChange={(e) => setEntryTime(e.target.value)}
                    className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                    required
                  />
                </div>
                </div>
              {/* Beverages Selection - UPDATED */}
              <div className={`order-9 md:order-none col-span-1 md:col-span-2 w-full md:w-[800px]  mx-auto mt-4 p-6 rounded-xl shadow-inner transition-colors duration-500
                ${isDarkMode ? 'bg-zinc-700 border border-zinc-700' : 'bg-gray-100 border border-gray-300'}`}>
                <h3 className={`text-xl flex font-bold mb-4 text-center ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
				🍿Food & Beverages🥤
				</h3>
                
                {/* Two dropdowns for selection and add button */}
                <div className="flex flex-wrap items-center gap-4 mb-4">
                  {/* Beverage selection dropdown */}
                  <select
                    value={tempSelectedBeverageId}
                    onChange={handleTempBeverageChange}
                    className={`flex-grow min-w-[150px] p-3 border rounded-lg shadow-sm input-focus-ring transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-800 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500'}`}
                  >
                    <option value="">Select Food & Beverage</option>
                    {allAvailableBeverages.map(bev => (
                      <option key={bev.id} value={bev.id}>
                        {bev.name} (₹{bev.price?.toFixed(2)})
                      </option>
                    ))}
                  </select>

                  {/* Quantity dropdown - only visible if a beverage is selected */}
                  {tempSelectedBeverageId && (
                    <select
                      value={tempSelectedBeverageQuantity}
                      onChange={handleTempQuantityChange}
                      className={`w-24 p-3 border rounded-lg shadow-sm input-focus-ring transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-800 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500'}`}
                    >
                      {QUANTITY_OPTIONS.map(qty => (
                        <option key={qty} value={qty}>{qty}</option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={handleAddBeverageToEntry}
                    className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg shadow-md hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 ease-in-out font-bold transform hover:scale-105"
                    disabled={!tempSelectedBeverageId || tempSelectedBeverageQuantity <= 0}
                  >
                    Add
                  </button>
                </div>

                {/* Display box for currently selected beverages */}
                {Object.keys(selectedBeverages).length > 0 && (
                  <div className={`mt-4 p-4 rounded-lg shadow-md ${isDarkMode ? 'bg-zinc-600 border border-zinc-500' : 'bg-gray-50 border border-gray-200'}`}>
                    <h4 className={`text-lg font-semibold mb-3 ${isDarkMode ? 'text-purple-300' : 'text-blue-600'}`}>Current Food & Beverages:</h4>
                    <ul className="space-y-3">
                      {Object.entries(selectedBeverages)
                        .sort((a, b) => getBeveragePrice(a[0]) * a[1] - getBeveragePrice(b[0]) * b[1]) // Sort by total price per item
                        .map(([bevKey, qty]) => (
                        <li key={bevKey} className="flex items-center justify-between flex-wrap gap-2">
                          <span className={`font-medium ${isDarkMode ? 'text-gray-100' : 'text-gray-700'} flex-grow`}>
                            {getBeverageDisplayName(bevKey)} (x{qty}) - ₹{(getBeveragePrice(bevKey) * qty)?.toFixed(2)}
                          </span>
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => updateAddedBeverageQuantity(bevKey, (qty || 0) - 1)}
                              className="px-3 py-1 bg-rose-600 text-white rounded-md shadow-sm hover:bg-rose-700 transition-colors duration-150 transform hover:scale-105"
                              disabled={!qty || qty <= 0}
                            >
                              -
                            </button>
                            <span className={`w-12 p-1 text-center rounded-md border ${isDarkMode ? 'bg-zinc-700 border-zinc-500 text-gray-200' : 'bg-white border-gray-300 text-gray-900'}`}>
                                {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateAddedBeverageQuantity(bevKey, (qty || 0) + 1)}
                              className="px-3 py-1 bg-emerald-600 text-white rounded-md shadow-sm hover:bg-emerald-700 transition-colors duration-150 transform hover:scale-105"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveSelectedBeverage(bevKey)}
                              className="ml-2 p-1 text-red-400 hover:text-red-600 transform hover:scale-110 transition-transform"
                              title="Remove Beverage"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm2 3a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm2 3a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}


                <div className="mt-6 flex flex-col sm:flex-row gap-4">
                  <input
                    type="text"
                    placeholder="New Food or Beverage Name"
                    value={newBeverageName}
                    onChange={(e) => setNewBeverageName(capitalizeFirstLetter(e.target.value))}
                    className={`flex-1 rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-800 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                  />
                  <input
                    type="number"
                    placeholder="Price"
                    value={newBeveragePrice}
                    onChange={(e) => setNewBeveragePrice(e.target.value)}
                    className={`w-28 rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-800 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                    min="0"
                    step="0.01"
                  />
                  <button
                    type="button"
                    onClick={handleAddBeverage}
                    className="px-6 py-3 bg-gradient-to-r from-teal-500 to-emerald-600 text-white rounded-lg shadow-lg hover:from-teal-600 hover:to-emerald-700 transition-all duration-200 ease-in-out font-bold transform hover:scale-105"
                  >
                    Add F&B
                  </button>
                </div>
              </div>

              <div className="order-10 md:order-none col-span-1 md:col-span-2 flex justify-center mt-8">
                <button
                  type="submit"
                  className="px-5 py-3 flex gap-1 bg-gradient-to-r from-blue-600 to-purple-700 text-white font-extrabold rounded-full shadow-lg shadow-blue-500/30 hover:from-blue-700 hover:to-purple-800 transform hover:scale-105 transition-all duration-300 ease-in-out"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Adding Entry ....' : 'Add New Entry'}
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
                </button>
              </div>
            </form>
          </div>

          {/* Customer Entries Table */}
          <div className={`w-full max-w-6xl p-8 rounded-2xl shadow-2xl mb-10 transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border border-purple-800 shadow-xl shadow-purple-700/30' : 'bg-white border border-blue-200 shadow-xl shadow-blue-400/30'}`}>
            <h2 className={`text-3xl font-extrabold mb-6 border-b-2 pb-4 flex gap-1 justify-center text-center transition-colors duration-500
              ${isDarkMode ? 'text-blue-400 border-purple-700' : 'text-blue-600 border-blue-300'}`}>Player Entries
				<svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 20" stroke="currentColor" strokeWidth={2}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
				</svg>
			  </h2>
            <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-between mb-6 gap-4">
			<div className="w-full sm:w-auto flex justify-center">
              <button
                onClick={() => setShowColumnVisibilityModal(true)}
                className="group px-3 py-2 flex bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold rounded-2xl shadow-md hover:from-purple-600 hover:to-indigo-700 transition-all duration-200 ease-in-out transform hover:scale-105"
              >
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
				</svg>
				    <span className="max-w-0 group-hover:max-w-xs opacity-0 group-hover:opacity-100 transform scale-x-0 group-hover:scale-x-100 overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out">
				Manage Columns
				</span>
              </button>
			  </div>
				<div className="flex flex-col items-center sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                <label className={`inline-flex items-center cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input
                    type="checkbox"
                    className="form-checkbox h-5 w-5 text-blue-600 rounded-md"
                    checked={showAllTodayEntries}
                    onChange={handleShowAllTodayChange}
                  />
                  <span className="ml-2">All Sessions (Active & Closed)</span>
                </label>
                <label className={`inline-flex items-center cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input
                    type="checkbox"
                    className="form-checkbox h-5 w-5 text-purple-600 rounded-md"
                    checked={showCurrentActiveEntries}
                    onChange={handleShowCurrentActiveChange}
                  />
                  <span className="ml-2">Active Sessions</span>
                </label>
              </div>
			  <div className="w-full sm:w-auto flex justify-center">
              <button
                onClick={() => handleExportToCsv(new Date().toISOString().slice(0, 10))}
                className="group px-3 flex py-2 bg-gradient-to-r from-green-500 to-green-700 text-white font-semibold rounded-2xl shadow-md hover:from-green-600 hover:to-green-800 transition-all duration-200 ease-in-out transform hover:scale-105"
                disabled={exporting}
              >
				<span className="max-w-0 group-hover:max-w-xs opacity-0 group-hover:opacity-100 transform scale-x-0 group-hover:scale-x-100 origin-left overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out">
				{exporting ? 'Exporting All Data...' : 'Export Full Report (CSV)'}
				</span>
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
				<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
				</svg>
              </button>
			  </div>
            </div>
            {entries.length === 0 ? (
              <p className={`text-center p-6 text-lg ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>No entries to display based on current filters.</p>
            ) : (
              <div className={`overflow-x-auto rounded-xl shadow-inner transition-colors duration-500
                ${isDarkMode ? 'border border-zinc-700' : 'border border-gray-200'}`}>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className={`${isDarkMode ? 'bg-zinc-700' : 'bg-gray-100'}`}>
					<tr>
                      {columnHeaders.map(col => (
                        (columnVisibility[col.key] || col.key === 'actions') && ( // Always show actions
                          <th key={col.key} className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                            {col.label}
                          </th>
                        )
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, index) => {
                      const { display: remainingTimeDisplay, status: timeStatus, percentage: percentageRemaining } = calculateRemainingTimeAndStatus(entry, entry.outTime, currentTime);

                      const displayHourlyRate = entry.gamingOption === 'Custom Price'
                        ? (entry.customHourlyRate || 0).toFixed(2)
                        : (GAMING_HOURLY_PRICES[entry.gamingOption] || 0).toFixed(2);

                      const getBeverageNameFromKey = (key) => {
                        // Use SORTED_FIXED_BEVERAGE_PRICES for lookup
                        if (SORTED_FIXED_BEVERAGE_PRICES[key] !== undefined) {
                          return key;
                        } else {
                          const bev = beverages.find(b => b.id === key);
                          return bev ? bev.name : 'Unknown';
                        }
                      };
                      
                      const beverageCount = Object.keys(entry.beverages || {}).length;
                      const beverageSummary = beverageCount === 0
                        ? 'None'
                        : `${beverageCount} item${beverageCount !== 1 ? 's' : ''}`;
                      
                      return (
                        <tr key={entry.id} className={`${isDarkMode ? (index % 2 === 0 ? 'bg-zinc-800' : 'bg-zinc-700') : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')} hover:${isDarkMode ? 'bg-zinc-600' : 'bg-gray-100'} transition duration-150 ease-in-out`}>
                          {columnVisibility.selectEntry && (
                            <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-200 border-b border-gray-100' : 'text-gray-900 border-b border-gray-300'}`}>
                              <input
                                type="checkbox"
                                className="form-checkbox h-5 w-5 text-blue-600 rounded-md"
                                checked={selectedEntryIds.has(entry.id)}
                                onChange={(e) => handleEntrySelect(entry.id, e.target.checked)}
                              />
                            </td>
                          )}
                          {columnVisibility.serialNumber && <td className={`px-4 py-2 whitespace-nowrap text-sm font-medium text-center ${isDarkMode ? 'text-gray-200 border-b border-gray-100' : 'text-gray-900 border-b border-gray-300'}`}>{entry.serialNumber}</td>}
						  {columnVisibility.date && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{new Date(entry.date).toLocaleDateString('en-GB')}</td>}
                          {/* Updated: Name color for dark mode */}
                          {columnVisibility.name && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center font-extrabold ${isDarkMode ? 'text-purple-300 border-b border-gray-100' : 'text-blue-800 border-b border-gray-300'}`}>{entry.name}</td>}
                          {columnVisibility.mobileNumber && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{entry.mobileNumber}</td>}
                          {columnVisibility.gamingOption && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{entry.gamingOption}</td>}
                          {columnVisibility.stationNumber && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{entry.stationNumber || 'N/A'}</td>} {/* NEW: Display Station Number */}
						  {columnVisibility.entryTime && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{formatTimeTo12Hr(entry.entryTime)}</td>}
						  {columnVisibility.outTime && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{formatTimeTo12Hr(entry.outTime)}</td>}
						  {columnVisibility.totalHours && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{entry.totalHours?.toFixed(2)}</td>}
                          
                          {/* Remaining Time Cell with Health Bar Effect - NO text-center on TD */}
                          {columnVisibility.remainingTime && (
						  <td className={`
                              px-4 py-2
                              ${isDarkMode ? 'border-b border-gray-100' : 'border-b border-gray-300'}
                          `}>
                            <div className={`
                                remaining-time-cell 
                                ${(timeStatus === 'final-seconds' || timeStatus === 'time-up') ? (isDarkMode ? 'dark-mode-blinking-bg' : 'blinking-bg') : ''}
                            `}>
                              <div
                                className="liquid-fill"
                                style={{
                                  width: timeStatus === 'time-up' ? '100%' : `${percentageRemaining}%`, // Fill 100% when time is up
                                  backgroundColor: timeStatus === 'time-up'
                                    ? '#8B0000' // Changed to Dark Red for time-up
                                    : getColorForPercentage(percentageRemaining),
                                }}
                              ></div>
                              {/* Conditionally apply text color and shadow based on dark mode and time status */}
                              <span className={`time-text-content`}
                                style={{
                                  color: (timeStatus === 'time-up' || isDarkMode) ? 'white' : '#1a202c', // White for time-up or dark mode, else black
                                  textShadow: (timeStatus === 'time-up' || isDarkMode) ? '0 0 3px rgba(0,0,0,0.8)' : '0 0 3px rgba(255,255,255,0.8)' // Dark shadow for time-up or dark mode, light shadow for light mode active
                                }}
                              >
                                {remainingTimeDisplay}
                              </span>
                            </div>
                          </td>
						  )}

                          {columnVisibility.hourlyRate && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-200 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{displayHourlyRate}</td>}
                          {columnVisibility.gamingPricing && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-200 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>₹{entry.gamingPricing?.toFixed(2)}</td>}
                          
                          {/* Beverages Summary and View Details Button */}
                          {columnVisibility.beverages && (
						  <td className={`px-4 py-2 text-sm text-center ${isDarkMode ? 'text-gray-200 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>
                            <div className="flex items-center justify-center gap-2">
                              <span title={beverageCount === 0 ? "No beverages" : `Click to view ${beverageCount} item(s)`} className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} whitespace-nowrap`}>
                                {beverageSummary}
                              </span>
                              {beverageCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenBeverageDetails(entry.beverages, entry.name)}
                                  className={`p-1 rounded-full ${isDarkMode ? 'text-blue-300 hover:bg-zinc-600' : 'text-blue-600 hover:bg-gray-200'} transition-colors duration-200`}
                                  title="View Food & Beverage Details"
                                >
                                  {/* Eye icon from lucide-react, using inline SVG */}
                                  <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-eye">
                                    <path d="M2 12s3-7 10-7s10 7 10 7s-3 7-10 7s-10-7-10-7Z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
						  )}
                          {columnVisibility.beveragePricing && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-200 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>₹{entry.beveragePricing?.toFixed(2)}</td>}
                          {columnVisibility.totalBill && <td className={`px-4 py-2 whitespace-nowrap text-sm font-extrabold text-center ${isDarkMode ? 'text-green-300 border-b border-gray-100' : 'text-green-600 border-b border-gray-300'}`}>₹{entry.totalBill?.toFixed(2)}</td>}
                          {columnVisibility.paymentMethod && <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{entry.paymentMethod}</td>}
                          <td className={`px-4 py-2 align-middle text-center ${isDarkMode ? 'border-b border-gray-100' : 'border-b border-gray-300'}`}>
                            <div className="flex items-center justify-center space-x-2">
							 <button
								onClick={() => handleNotesClick(entry)}
								className={`p-2 rounded-md shadow-md transition-all duration-200 ease-in-out transform hover:scale-105 ${
								entry.notes 
								? 'bg-gradient-to-r from-yellow-500 to-amber-500 text-white' 
								: 'bg-gray-500 text-white'
								}`}
								title={entry.notes ? "View/Edit Note" : "Add Note"}
								>
								<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
								<path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
								</svg>
							</button>
                              <button
                                onClick={() => handleEditClick(entry)}
                                className="px-3 py-2 bg-gradient-to-r from-indigo-500 to-blue-600 text-white rounded-md shadow-md hover:from-indigo-600 hover:to-blue-700 transition-all duration-200 ease-in-out transform hover:scale-105"
								title="Edit Entry"
							  >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
								</svg>
                              </button>
                              <button
                                onClick={() => handleDeleteEntryClick(entry)}
                                className="px-3 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-md shadow-md hover:from-red-600 hover:to-rose-700 transition-all duration-200 ease-in-out transform hover:scale-105"
								title="Delete Entry"
							  >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
								<path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm2 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
								</svg>
                              </button>
                                {/* NEW: QR Code Implementation - Generate QR Button */}
                                <button
                                  onClick={() => handleGenerateQrClick(entry)}
                                  className="px-3 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-md shadow-md hover:from-cyan-600 hover:to-blue-600 transition-all duration-200 ease-in-out transform hover:scale-105"
                                  title="Generate One-Time Redemption QR Code"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
								  <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM13 21h8v-8h-8v8zm2-6h4v4h-4v-4z"/>
								  </svg>
                                </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
		
		{/* NEW: QR Code Display Modal */}
			{showQrModal && currentQrEntry && (
		<div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
        <div className={`rounded-xl shadow-2xl p-8 w-full max-w-sm relative border transform scale-95 animate-scale-in transition-colors duration-500 ${isDarkMode ? 'bg-zinc-800 border-2 border-purple-800' : 'bg-white border-2 border-indigo-300'}`}>
            <div className="flex justify-between items-center pb-3 border-b-2 border-purple-500 mb-4">
                <h3 className={`text-2xl font-bold ${isDarkMode ? 'text-purple-400' : 'text-indigo-600'}`}>QR Code</h3>
                <button className={`p-2 rounded-full ${isDarkMode ? 'text-gray-400 hover:bg-zinc-700' : 'text-gray-500 hover:bg-gray-100'}`} onClick={() => setShowQrModal(false)}>
                    <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <p className={`text-center font-semibold mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Scan this code to redeem for <br />
                <span className="font-bold">{currentQrEntry.name}</span>
            </p>
            <div
			id="qrCodeElement"
			className="flex justify-center mb-4 p-2 bg-white rounded-lg border-2 border-gray-300">
                {/* Now only showing the raw token in the QR code */}
                <QRCodeCanvas
                    value={redemptionFullUrl}
                    size={256}
                    level={"H"}
					imageSettings={{
					src: "./images/logo.jpg", // The path to your logo in the public folder
					height: 48,
					width: 48,
					excavate: true, // This clears the area behind the logo
					}}

                />
            </div>
            <p className={`text-center text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Note: This is a one-time use code.
            </p>
            
            {/* Share and Copy buttons */}
            <div className="flex flex-col gap-2 mt-4">
                <button
                    onClick={downloadQrCode} // Copy the raw QR code data
                    className="w-full gap-1 justify-center items-center flex px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-md shadow-md hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 ease-in-out transform hover:scale-105"
                >
                    Download QR
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
					</svg>
                </button>
            </div>
        </div>
    </div>
)}

          {/* Today's Collection Summary (Password Protected) */}
          <div className={`w-full max-w-xl p-8 rounded-2xl shadow-2xl mt-10 transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border border-purple-700 shadow-xl shadow-purple-700/30' : 'bg-white border border-indigo-200 shadow-xl shadow-blue-400/30'}`}>
            <h2 className={`text-2xl flex gap-1 font-extrabold mb-6 border-b-2 pb-4 justify-center text-center transition-colors duration-500
              ${isDarkMode ? 'text-yellow-400 border-purple-700' : 'text-yellow-400 border-indigo-300'}`}>Today's Collection Summary
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 20" stroke-width="1.5" stroke="currentColor" class="size-7">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 8.25H9m6 3H9m3 6-3-3h1.5a3 3 0 1 0 0-6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
				</svg>
			  </h2>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-4">
              <input
                type="password"
                placeholder="Enter Admin Password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className={`flex-1 rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                  ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
              />
              <button
                onClick={handleVerifyPassword}
                className="px-6 py-3 bg-gradient-to-r from-yellow-500 to-amber-600 text-white font-semibold rounded-lg shadow-md hover:from-yellow-600 hover:to-amber-800 transition-all duration-200 ease-in-out transform hover:scale-105"
              >
                Show Total
              </button>
            </div>
            {passwordError && (
              <p className="text-red-500 text-center text-sm mb-4">{passwordError}</p>
            )}

            {showTotalCollection && (
              <div className={`mt-6 p-4 rounded-lg text-center font-bold text-xl transition-colors duration-500 animate-fade-in
                ${isDarkMode ? 'bg-zinc-700 text-green-400 border border-green-600' : 'bg-gray-100 text-green-400 border border-green-300'}`}>
                Total Collection Today: ₹{todayTotalCollection.toFixed(2)}
              </div>
            )}
          </div>

          {/* Change Admin Password Button (positioned to the right, matching max-w-6xl) */}
          <div className="w-full max-w-6xl flex justify-end mt-6">
            <button
              onClick={() => {
                setShowChangePasswordModal(true);
                setNewOldPasswordInput('');
                setNewPasswordInput('');
                setConfirmNewPasswordInput('');
                setChangePasswordError('');
              }}
              // Updated className for gradient and consistent styling
              className="p-3 bg-gradient-to-r from-blue-700 to-purple-800 text-white rounded-full shadow-lg hover:from-blue-800 hover:to-purple-900 transition-all duration-200 ease-in-out transform hover:scale-105 flex items-center justify-center"
              title="Change Admin Password"
            >
              {/* Updated icon to LockKeyhole for better representation */}
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-lock-keyhole">
                <path d="M12 2C9.24 2 7 4.24 7 7v4H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-3V7c0-2.76-2.24-5-5-5z"></path>
                <circle cx="12" cy="12" r="2"></circle>
              </svg>
            </button>
          </div>
        </>
      )}

      {activeTab === 'advanceBooking' && (
        <>
          {/* Advance Booking Form */}
          <div className={`w-full max-w-6xl p-8 rounded-2xl shadow-2xl mb-10 transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border border-green-600 shadow-xl shadow-green-700/30' : 'bg-white border border-green-200 shadow-xl shadow-green-400/30'}`}>
            <h2 className={`text-3xl font-extrabold mb-6 border-b-2 pb-4 flex gap-1 justify-center text-center transition-colors duration-500
              ${isDarkMode ? 'text-green-400 border-green-700' : 'text-green-600 border-green-300'}`}>Advance Booking
				<svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
				</svg>
			  </h2>
            <form onSubmit={handleAddAdvanceBooking} className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {/* Main Booking Fields with Vertical Separator */}
              <div className="order-1 md:order-none flex flex-col items-center">
                  <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width and relative for suggestions */}
                    <label htmlFor="advanceBookingName" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Name</label>
                    <input
                      type="text"
                      id="advanceBookingName"
                      value={advanceBookingName}
                      onChange={handleAdvanceBookingNameInputChange}
                      onFocus={() => setShowAdvanceBookingCustomerSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowAdvanceBookingCustomerSuggestions(false), 100)}
                      className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                      required
                      autoComplete="off"
                    />
                    {showAdvanceBookingCustomerSuggestions && advanceBookingCustomerSuggestions.length > 0 && (
                      <ul className={`absolute z-10 w-full rounded-md shadow-lg max-h-60 overflow-auto ring-1 ring-black ring-opacity-5 focus:outline-none
                        ${isDarkMode ? 'bg-zinc-700 text-gray-200' : 'bg-white text-gray-900'}`}>
                        {advanceBookingCustomerSuggestions.map((customer) => (
                          <li
                            key={customer.id}
                            onMouseDown={() => handleSelectCustomerForBooking(customer)}
                            className={`cursor-pointer select-none relative py-2 pl-3 pr-9 ${isDarkMode ? 'hover:bg-zinc-600' : 'hover:bg-gray-100'}`}
                          >
                            {customer.name} ({customer.mobileNumber})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
				  </div>
                <div className="order-2 md:order-none flex flex-col items-center">
                  <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width and relative for suggestions */}
                    <label htmlFor="advanceBookingMobile" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Mobile Number</label>
                    <input
                      type="tel"
                      id="advanceBookingMobile"
                      value={advanceBookingMobile}
                      onChange={handleAdvanceBookingMobileInputChange}
                      onFocus={() => setShowAdvanceBookingCustomerSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowAdvanceBookingCustomerSuggestions(false), 100)}
                      className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                      pattern="[0-9]{10}"
                      maxLength="10"
                      required
                      autoComplete="off"
                    />
                     {showAdvanceBookingCustomerSuggestions && advanceBookingCustomerSuggestions.length > 0 && (
                      <ul className={`absolute z-10 w-full rounded-md shadow-lg max-h-60 overflow-auto ring-1 ring-black ring-opacity-5 focus:outline-none
                        ${isDarkMode ? 'bg-zinc-700 text-gray-200' : 'bg-white text-gray-900'}`}>
                        {advanceBookingCustomerSuggestions.map((customer) => (
                          <li
                            key={customer.id}
                            onMouseDown={() => handleSelectCustomerForBooking(customer)}
                            className={`cursor-pointer select-none relative py-2 pl-3 pr-9 ${isDarkMode ? 'hover:bg-zinc-600' : 'hover:bg-gray-100'}`}
                          >
                            {customer.mobileNumber} ({customer.name})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
				  </div>				  
				  <div className="order-3 md:order-none flex flex-col items-center">
                  <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width */}
                    <label htmlFor="numPlayers" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Number of Players</label>
                    <input
                      type="number"
                      id="numPlayers"
                      value={numPlayers}
                      onChange={(e) => setNumPlayers(parseInt(e.target.value) || 1)}
                      min="1"
                      className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                      required
                    />
                  </div>
				  </div>				  
				  <div className="order-4 md:order-none flex flex-col items-center">
				  <div className="w-full sm:max-w-sm">
						<label htmlFor="advanceBookingGamingOption" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Gaming Option</label>
						<select
						id="advanceBookingGamingOption"
						value={advanceBookingGamingOption}
						onChange={(e) => setAdvanceBookingGamingOption(e.target.value)}
						className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
						>
						{Object.keys(GAMING_HOURLY_PRICES).map((option) => (
						<option key={option} value={option}>{option}</option>
							))}
						</select>
					</div>
	               </div>
				  <div className="order-5 md:order-none flex flex-col items-center">
                  <div className="w-full sm:max-w-sm"> {/* Added wrapper to limit input width */}
                    <label htmlFor="timeSlot" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Time Slot</label>
                    <select
                      id="timeSlot"
                      value={timeSlot}
                      onChange={(e) => setTimeSlot(e.target.value)}
                      className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                      required
                    >
                      {dynamicTimeSlots.length === 0 ? (
                        <option value="" disabled>No upcoming slots available</option>
                      ) : (
                        dynamicTimeSlots.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))
                      )}
                    </select>
                  </div>
				  </div>				   
				  <div className="order-6 md:order-none flex flex-col items-center">
				  <div className="w-full sm:max-w-sm"> {/* Date for Booking */}
                    <label htmlFor="bookingDate" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Booking Date</label>
                    <input
                      type="date"
                      id="bookingDate"
                      value={selectedBookingDate}
                      onChange={(e) => {
                        setSelectedBookingDate(e.target.value);
                        // Reset time slot when date changes to ensure valid options
                        setTimeSlot('');
                      }}
                      className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                      required
					  min={new Date().toISOString().slice(0, 10)} // Set min date to today's date
                    />
				</div>
                </div>

              <div className="order-7 md:order-none col-span-1 md:col-span-2 flex justify-center mt-8">
                <button
                  type="submit"
                  className="px-5 gap-1 py-4 flex bg-gradient-to-r from-green-600 to-teal-700 text-white font-extrabold rounded-full shadow-lg shadow-green-500/30 hover:from-green-700 hover:to-teal-800 transform hover:scale-105 transition-all duration-300 ease-in-out"
                  disabled={dynamicTimeSlots.length === 0} // Disable if no slots are available
                >
                  Book Now
					<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
					</svg>
                </button>
              </div>
            </form>
          </div>


          {/* Advance Booking Table */}
          <div className={`w-full max-w-6xl p-8 rounded-2xl shadow-2xl mb-10 transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border border-green-600 shadow-xl shadow-green-700/30' : 'bg-white border border-green-200 shadow-xl shadow-green-400/30'}`}>
            <h2 className={`text-3xl font-extrabold mb-6 border-b-2 pb-4 text-center flex gap-1 justify-center transition-colors duration-500
              ${isDarkMode ? 'text-green-400 border-green-700' : 'text-green-600 border-green-300'}`}>Advance Booking (Entries)
			  <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
			  </svg>
			  </h2>
            <div className="flex flex-col sm:flex-row justify-center items-center mb-6">
                <label htmlFor="viewBookingDate" className={`block text-sm font-medium mr-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>View Bookings For:</label>
                <input
                    type="date"
                    id="viewBookingDate"
                    value={selectedBookingDateForTable}
                    onChange={(e) => setSelectedBookingDateForTable(e.target.value)}
                    className={`block w-48 rounded-lg shadow-sm p-2 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
					required
					min={new Date().toISOString().slice(0, 10)} // Set min date to today's date
				/>
            </div>
			{advanceBookings.length === 0 ? (
              <p className={`text-center p-6 text-lg ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>No advance bookings yet. Add one using the form above!</p>
            ) : (
              <div className={`overflow-x-auto rounded-xl shadow-inner transition-colors duration-500
                ${isDarkMode ? 'border border-zinc-700' : 'border border-gray-200'}`}>
                <table className="min-w-full">
                  <thead className={`${isDarkMode ? 'bg-zinc-700' : 'bg-gray-100'}`}>
                    <tr>
                      <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Name</th>
                      <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Mobile</th>
                      <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Players</th>
					  <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Gaming Option</th> 
                      <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Time Slot</th>
                      <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Booked On</th>
                      <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advanceBookings.map((booking, index) => (
                      <tr key={booking.id} className={`${isDarkMode ? (index % 2 === 0 ? 'bg-zinc-800' : 'bg-zinc-700') : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')} hover:${isDarkMode ? 'bg-zinc-600' : 'bg-gray-100'} transition duration-150 ease-in-out`}>
                        <td className={`px-4 py-2 whitespace-nowrap text-sm font-medium text-center ${isDarkMode ? 'text-purple-300 border-b border-gray-100' : 'text-gray-900 border-b border-gray-300'}`}>{booking?.name}</td>
                        <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-500 border-b border-gray-300'}`}>{booking?.mobileNumber}</td>
                        <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-500 border-b border-gray-300'}`}>{booking?.numPlayers}</td>
                        <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-500 border-b border-gray-300'}`}>{booking?.gamingOption || 'N/A'}</td>
                        <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-500 border-b border-gray-300'}`}>{booking?.timeSlot}</td>
                        <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-500 border-b border-gray-300'}`}>
                          {booking?.timestamp?.toDate ? new Date(booking.timestamp.toDate()).toLocaleDateString('en-GB') : 'N/A'}
                        </td>
                        <td className={`px-4 py-2 align-middle text-center ${isDarkMode ? 'border-b border-gray-100' : 'border-b border-gray-300'}`}>
                          <div className="flex items-center justify-center space-x-2">
                             <button
                                onClick={() => handleEditAdvanceBookingClick(booking)}
                                className="px-3 py-2 bg-gradient-to-r from-indigo-500 to-blue-600 text-white rounded-md shadow-md hover:from-indigo-600 hover:to-blue-700 transition-all duration-200 ease-in-out transform hover:scale-105"
                                title="Edit Advance Booking"
							  >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
								</svg>
                              </button>
                            <button
                              onClick={() => handleDeleteAdvanceBooking(booking.id, booking.name)}
                              className="px-3 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-md shadow-md hover:from-red-600 hover:to-rose-700 transition-all duration-200 ease-in-out transform hover:scale-105"
							  title="Delete Advance Booking"
							>
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
							  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm2 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
							  </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

{/* Advance Booking Edit Entry Modal */}
{isEditingAdvanceBooking && currentEditAdvanceBooking && (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
        <div className={`rounded-xl shadow-2xl p-8 w-full max-w-md relative border transform scale-95 animate-scale-in transition-colors duration-500 max-h-[90vh] overflow-y-auto ${isDarkMode ? 'bg-zinc-800 border-2 border-green-800' : 'bg-white border-2 border-teal-300'}`}>
            <div className="flex justify-between items-center pb-3 border-b-2 border-teal-500 mb-4">
                <h3 className={`text-2xl text-center font-bold ${isDarkMode ? 'text-green-400' : 'text-teal-600'}`}>
                    Edit Advance Booking For <span className={`${isDarkMode ? 'text-teal-400' : 'text-indigo-600'}`}>{currentEditAdvanceBooking.name}</span>
                </h3>
                <button
                    className={`p-2 rounded-full ${isDarkMode ? 'text-gray-400 hover:bg-zinc-700' : 'text-gray-500 hover:bg-gray-100'}`}
                    onClick={() => setIsEditingAdvanceBooking(false)}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <form onSubmit={handleUpdateAdvanceBooking}>
                <div className="mb-4 items-center">
                    <label className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Number of Players</label>
                    <input
                        type="number"
                        value={editNumPlayers}
                        onChange={(e) => setEditNumPlayers(parseInt(e.target.value, 10))}
                        className={`w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500 ${isDarkMode ? 'bg-zinc-700 border-zinc-600 text-gray-200' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                        min="1"
                        required
                    />
                </div>
				<div className="mb-4 items-center">
                    <label className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Gaming Option</label>
                        <select
					value={editAdvanceBookingGamingOption}
					onChange={(e) => setEditAdvanceBookingGamingOption(e.target.value)}
					className={`w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500 ${isDarkMode ? 'bg-zinc-700 border-zinc-600 text-gray-200' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
					required
					>
					{Object.keys(GAMING_HOURLY_PRICES).map((option) => (
					<option key={option} value={option}>{option}</option>
					))}
						</select>

                </div>
                <div className="mb-4">
                    <label className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Booking Date</label>
                    <input
                        type="date"
                        value={editSelectedBookingDate}
                        onChange={(e) => setEditSelectedBookingDate(e.target.value)}
                        className={`w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500 ${isDarkMode ? 'bg-zinc-700 border-zinc-600 text-gray-200' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                        required
                    />
                </div>
                <div className="mb-6">
                    <label className={`block text-sm text-center font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Time Slot</label>
                    <select
                        value={editTimeSlot}
                        onChange={(e) => setEditTimeSlot(e.target.value)}
                        className={`w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500 ${isDarkMode ? 'bg-zinc-700 border-zinc-600 text-gray-200' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                        required
                    >
                        {dynamicTimeSlotsForEdit.length > 0 ? (
                            dynamicTimeSlotsForEdit.map(slot => (
                                <option key={slot} value={slot}>{slot}</option>
                            ))
                        ) : (
                            <option value="" disabled>No time slots available</option>
                        )}
                    </select>
                </div>
                <div className="flex justify-end space-x-4">
                    <button
                        type="button"
                        onClick={() => setIsEditingAdvanceBooking(false)}
                        className={`px-6 py-3 rounded-lg font-semibold shadow-md transform hover:scale-105 transition-all duration-300 ease-in-out ${isDarkMode ? 'bg-zinc-700 text-gray-200 hover:bg-zinc-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="px-6 py-3 bg-gradient-to-r from-teal-500 to-green-600 text-white font-semibold rounded-lg shadow-lg hover:from-teal-600 transform hover:scale-105 hover:to-green-700 transition-all duration-300 ease-in-out"
                    >
                        Update Booking
                    </button>
                </div>
            </form>
        </div>
    </div>
)}


      {activeTab === 'customerManagement' && (
        <>
          {/* Customer Management Section */}
          <div className={`w-full max-w-6xl p-8 rounded-2xl shadow-2xl mb-10 transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border border-teal-600 shadow-xl shadow-teal-700/30' : 'bg-white border border-teal-200 shadow-xl shadow-teal-400/30'}`}>
            <h2 className={`text-3xl font-extrabold mb-6 border-b-2 pb-4 flex gap-1 justify-center text-center transition-colors duration-500
              ${isDarkMode ? 'text-teal-400 border-teal-700' : 'text-teal-600 border-teal-300'}`}>Player Management
			<svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.125-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.125-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
			</svg>
			  </h2>

            {!showCustomerManagementContent ? (
              <div className="flex flex-col items-center justify-center gap-4 py-8">
                <p className={`text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Enter admin password to access player details:</p>
                <input
                  type="password"
                  placeholder="Admin Password"
                  value={customerManagementPassword}
                  onChange={(e) => setCustomerManagementPassword(e.target.value)}
                  className={`w-full max-w-sm rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                />
                {customerManagementPasswordError && (
                  <p className="text-red-500 text-center text-sm">{customerManagementPasswordError}</p>
                )}
                <button
                  onClick={handleVerifyCustomerManagementPassword}
                  className="px-8 py-3 bg-gradient-to-r from-teal-600 to-cyan-700 text-white font-bold rounded-full shadow-lg hover:from-teal-700 hover:to-cyan-800 hover:scale-105 transition-all duration-300 ease-in-out"
                >
                  Unlock
                </button>
              </div>
            ) : (
              <>
                {/* Add New Customer Form */}
                <div className={`mb-8 p-6 rounded-xl shadow-inner transition-colors duration-500
                  ${isDarkMode ? 'bg-zinc-700 border border-zinc-600' : 'bg-gray-100 border border-gray-300'}`}>
                  <h3 className={`text-xl font-bold mb-4 text-center flex gap-1 justify-center ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Add New Player
					<svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
					</svg>
				  </h3>
                  <form onSubmit={handleAddCustomer} className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                    <input
                      type="text"
                      placeholder="Player Name"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(capitalizeFirstLetter(e.target.value))}
                      className={`flex-1 rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-800 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                      required
                    />
                    <input
                      type="tel"
                      placeholder="Mobile Number (10 digits)"
                      value={newCustomerMobile}
                      onChange={(e) => setNewCustomerMobile(e.target.value)}
                      maxLength="10"
                      pattern="[0-9]{10}"
                      className={`flex-1 rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-800 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                      required
                    />
                    <button
                      type="submit"
                      className="px-3 py-3 flex gap-1 bg-gradient-to-r from-teal-500 to-emerald-600 text-white rounded-lg shadow-lg hover:from-teal-600 hover:to-emerald-700 transition-all duration-200 ease-in-out font-bold transform hover:scale-105"
                    >
                      Add Customer
					  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
                    </button>
                  </form>
                </div>
				
				{/* Search Input for Customer List */}
                <div className="mb-6 flex justify-center">
                  <input
                    type="text"
                    placeholder="Search players by name or mobile..."
                    value={customerSearchTerm}
                    onChange={handleCustomerSearchChange}
                    className={`w-full max-w-lg rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                  />
                </div>

                {/* Customer List Table */}
                {customers.length === 0 ? (
                  <p className={`text-center p-6 text-lg ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>No customers added yet.</p>
                ) : (
                  <div className={`overflow-x-auto rounded-xl shadow-inner transition-colors duration-500
                    ${isDarkMode ? 'border border-zinc-700' : 'border border-gray-200'}`}>
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className={`${isDarkMode ? 'bg-zinc-700' : 'bg-gray-100'}`}>
                        <tr>
                          <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Name</th>
                          <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Mobile Number</th>
                          <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Last Visited</th>
                          <th className={`px-4 py-3 text-center text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCustomers.map((customer, index) => (
                          <tr key={customer.id} className={`${isDarkMode ? (index % 2 === 0 ? 'bg-zinc-800' : 'bg-zinc-700') : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')} hover:${isDarkMode ? 'bg-zinc-600' : 'bg-gray-100'} transition duration-150 ease-in-out`}>
                            <td className={`px-4 py-2 whitespace-nowrap text-sm font-medium text-center ${isDarkMode ? 'text-purple-300 border-b border-gray-100' : 'text-gray-900 border-b border-gray-300'}`}>{customer.name}</td>
                            <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>{customer.mobileNumber}</td>
                            <td className={`px-4 py-2 whitespace-nowrap text-sm text-center ${isDarkMode ? 'text-gray-300 border-b border-gray-100' : 'text-gray-700 border-b border-gray-300'}`}>
                              {customer.lastVisited?.toDate ? new Date(customer.lastVisited.toDate()).toLocaleDateString('en-GB') : 'N/A'}
                            </td>
                            <td className={`px-4 py-2 align-middle text-center ${isDarkMode ? 'border-b border-gray-100' : 'border-b border-gray-300'}`}>
                              <div className="flex items-center justify-center space-x-2">
                                <button
                                  onClick={() => handleEditCustomerClick(customer)}
                                  className="px-3 py-2 bg-gradient-to-r from-indigo-500 to-blue-600 text-white rounded-md shadow-md hover:from-indigo-600 hover:to-blue-700 transition-all duration-200 ease-in-out transform hover:scale-105"
								  title="Edit Player"
								>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
								  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
								  </svg>
                                </button>
                                <button
                                  onClick={() => handleDeleteCustomerClick(customer)}
                                  className="px-3 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-md shadow-md hover:from-red-600 hover:to-rose-700 transition-all duration-200 ease-in-out transform hover:scale-105"
								  title="Delete Player"
								>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
								  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm2 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
								  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Edit Entry Modal (remains a full modal) */}
      {isEditing && currentEditEntry && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`rounded-xl shadow-2xl p-8 w-full max-w-md relative border transform scale-95 animate-scale-in transition-colors duration-500 max-h-[90vh] overflow-y-auto
            ${isDarkMode ? 'bg-zinc-800 border-purple-700' : 'bg-white border-blue-300'}`}>
            <h2 className={`text-2xl font-bold mb-6 border-b-2 pb-4 text-center transition-colors duration-500
              ${isDarkMode ? 'text-purple-400' : 'text-blue-700 border-blue-300'}`}>Edit Entry For <span className={`${isDarkMode ? 'text-teal-400' : 'text-indigo-600'}`}>{currentEditEntry.name}</span></h2>
            <form onSubmit={handleUpdateEntry} className="grid grid-cols-1 gap-y-6 items-center"> {/* Centered content */}
              <div className="w-full max-w-sm"> {/* Added wrapper to limit input width */}
							  <label className="flex items-center cursor-pointer mb-2 justify-end">
						<input
							type="checkbox"
							checked={editApplyDiscount}
							onChange={(e) => setEditApplyDiscount(e.target.checked)}
							className="form-checkbox h-4 w-4 text-green-500 rounded"
						/>
						<span className={`ml-2 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
							Apply Discount
						</span>
					</label>
                <label htmlFor="editGamingOption" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Gaming Option:</label>
                <select
                  id="editGamingOption"
                  value={editGamingOption}
                  onChange={(e) => {
                    setEditGamingOption(e.target.value);
                    if (e.target.value !== 'Custom Price') {
                      setEditCustomGamingPrice('');
                    }
					setEditStationNumber('');
                  }}
                  className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                >
                  {Object.keys(GAMING_HOURLY_PRICES).map((option) => (
                    <option key={option} value={option}>{option} {option !== 'Custom Price' ? `(₹${GAMING_HOURLY_PRICES[option]}/hr)` : ''}</option>
                  ))}
                </select>
                {editGamingOption === 'Custom Price' && (
                  <input
                    type="number"
                    placeholder="Enter Custom Hourly Rate (₹)"
                    value={editCustomGamingPrice}
                    onChange={(e) => setEditCustomGamingPrice(e.target.value)}
                    className={`mt-2 block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                    min="0"
                    step="0.01"
                    required
                  />
                )}
              </div>
              {/* NEW: Station Number Dropdown in Edit Modal */}
              {(editGamingOption.startsWith('PC') || editGamingOption.startsWith('PS') || editGamingOption === 'Racing Cockpit' || editGamingOption === 'Custom Price') && (
              <div className="w-full max-w-sm">
                <label htmlFor="editStationNumber" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Station No.:</label>
                <select
                  id="editStationNumber"
                  value={editStationNumber}
                  onChange={(e) => setEditStationNumber(e.target.value)}
                  className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                  required={editGamingOption.startsWith('PC') || editGamingOption.startsWith('PS') || editGamingOption === 'Racing Cockpit' || editGamingOption === 'Custom Price'}
                >
                  <option value="">Select Station</option>
                  {getFilteredStationOptions(editGamingOption, true, currentEditEntry.stationNumber, currentEditEntry.gamingOption).length > 0 ? (
                      getFilteredStationOptions(editGamingOption, true, currentEditEntry.stationNumber, currentEditEntry.gamingOption).map(station => (
                        <option key={station} value={station}>{station}</option>
                      ))
                    ) : (
                      <option value="" disabled>No stations available</option>
                    )}
                </select>
              </div>
              )}			  
              {/* Duration in Edit Mode */}
              <div className="w-full max-w-sm"> {/* Added wrapper to limit input width */}
                <label htmlFor="editDuration" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Duration:</label>
                <select
                  id="editDuration"
                  value={editDuration}
                  onChange={(e) => {
                    setEditDuration(e.target.value);
                    if (e.target.value !== 'custom') {
                        setEditCustomDuration('');
                    }
                  }}
                  className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                >
                  {DURATION_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {editDuration === 'custom' && (
                    <input
                        type="number"
                        placeholder="Enter Duration in Hours" 
                        value={editCustomDuration}
                        onChange={(e) => setEditCustomDuration(e.target.value)}
                        className={`mt-2 block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                          ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                        min="1"
                        step="0.5" 
                        required
                    />
                )}
              </div>
              {/* Payment Method */}
              <div className="w-full max-w-sm"> {/* Added wrapper to limit input width */}
                <label htmlFor="editPaymentMethod" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Payment Method:</label>
                <select
                  id="editPaymentMethod"
                  value={editPaymentMethod}
                  onChange={(e) => setEditPaymentMethod(e.target.value)}
                  className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                >
                  <option value="Cash">Cash</option>
                  <option value="Online">Online</option>
                </select>
              </div>

              {/* Beverages Selection for Edit - UPDATED */}
              <div className={`mt-4 p-6 rounded-xl shadow-inner transition-colors duration-500
                ${isDarkMode ? 'bg-zinc-700 border border-zinc-700' : 'bg-gray-100 border border-gray-300'}`}>
                <h3 className={`text-xl font-bold mb-4 flex ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>🍿Food & Beverages🥤:</h3>
                
                {/* Two dropdowns for selection and add button in edit mode */}
                <div className="flex flex-wrap items-center gap-4 mb-4">
                  <select
                    value={editTempSelectedBeverageId}
                    onChange={handleEditTempBeverageChange}
                    className={`flex-grow min-w-[150px] p-3 border rounded-lg shadow-sm input-focus-ring transition-colors duration-500
                      ${isDarkMode ? 'border-zinc-600 bg-zinc-800 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500'}`}
                  >
                    <option value="">Select Food & Beverage</option>
                    {allAvailableBeverages.map(bev => (
                      <option key={bev.id} value={bev.id}>
                        {bev.name} (₹{bev.price?.toFixed(2)})
                      </option>
                    ))}
                  </select>

                  {editTempSelectedBeverageId && (
                    <select
                      value={editTempSelectedBeverageQuantity}
                      onChange={handleEditTempQuantityChange}
                      className={`w-24 p-3 border rounded-lg shadow-sm input-focus-ring transition-colors duration-500
                        ${isDarkMode ? 'border-zinc-600 bg-zinc-800 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500'}`}
                    >
                      {QUANTITY_OPTIONS.map(qty => (
                        <option key={qty} value={qty}>{qty}</option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={handleEditAddBeverageToEntry}
                    className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg shadow-md hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 ease-in-out font-bold transform hover:scale-105"
                    disabled={!editTempSelectedBeverageId || editTempSelectedBeverageQuantity <= 0}
                  >
                    Add
                  </button>
                </div>

                {Object.keys(editSelectedBeverages).length > 0 && (
                  <div className={`mt-4 p-4 rounded-lg shadow-md ${isDarkMode ? 'bg-zinc-600 border border-zinc-500' : 'bg-gray-50 border border-gray-200'}`}>
                    <h4 className={`text-lg font-semibold mb-3 ${isDarkMode ? 'text-purple-300' : 'text-blue-600'}`}>Current Food & Beverages:</h4>
                    <ul className="space-y-3">
                      {Object.entries(editSelectedBeverages)
                         .sort((a, b) => getBeveragePrice(a[0]) * a[1] - getBeveragePrice(b[0]) * b[1]) // Sort by total price per item
                        .map(([bevKey, qty]) => (
                        <li key={bevKey} className="flex items-center justify-between flex-wrap gap-2">
                          <span className={`font-medium ${isDarkMode ? 'text-gray-100' : 'text-gray-700'} flex-grow`}>
                            {getBeverageDisplayName(bevKey)} (x{qty}) - ₹{(getBeveragePrice(bevKey) * qty)?.toFixed(2)}
                          </span>
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => updateEditAddedBeverageQuantity(bevKey, (qty || 0) - 1)}
                              className="px-3 py-1 bg-rose-600 text-white rounded-md shadow-sm hover:bg-rose-700 transition-colors duration-150 transform hover:scale-105"
                              disabled={!qty || qty <= 0}
                            >
                              -
                            </button>
                            <span className={`w-12 p-1 text-center rounded-md border ${isDarkMode ? 'bg-zinc-700 border-zinc-500 text-gray-200' : 'bg-white border-gray-300 text-gray-900'}`}>
                                {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateEditAddedBeverageQuantity(bevKey, (qty || 0) + 1)}
                              className="px-3 py-1 bg-emerald-600 text-white rounded-md shadow-sm hover:bg-emerald-700 transition-colors duration-150 transform hover:scale-105"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditSelectedBeverages(prev => {
                                var newSelected = { ...prev };
                                delete newSelected[bevKey];
                                return newSelected;
                              })}
                              className="ml-2 p-1 text-red-400 hover:text-red-600 transform hover:scale-110 transition-transform"
                              title="Remove Beverage"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm2 3a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm2 3a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-4 mt-8">
                <button
                  type="button"
                  onClick={handleCloseEditModal}
                  className={`px-6 py-3 rounded-full font-semibold transition-colors transition-all duration-300 ease-in-out transform hover:scale-105
                    ${isDarkMode ? 'border border-gray-600 text-gray-300 hover:bg-zinc-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                >
                  Cancel
                  </button>
                <button
                  type="submit"
                  className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-700 text-white font-bold rounded-full shadow-lg hover:from-blue-700 hover:to-purple-800 transition-all duration-300 ease-in-out transform hover:scale-105"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW: Edit Customer Modal */}
      {isEditingCustomer && currentEditCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`rounded-xl shadow-2xl p-8 w-full max-w-sm relative border transform scale-95 animate-scale-in transition-colors duration-500 max-h-[90vh] overflow-y-auto
            ${isDarkMode ? 'bg-zinc-800 border-teal-700' : 'bg-white border-green-300'}`}>
            <h2 className={`text-2xl font-bold mb-6 border-b-2 pb-4 text-center ${isDarkMode ? 'text-teal-400' : 'text-green-700'}`}>Edit Customer</h2>
            <form onSubmit={handleUpdateCustomer} className="flex flex-col gap-y-6 items-center">
              <div className="w-full max-w-xs">
                <label htmlFor="editCustomerName" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Name:</label>
                <input
                  type="text"
                  id="editCustomerName"
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(capitalizeFirstLetter(e.target.value))}
                  className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                  required
                />
              </div>
              <div className="w-full max-w-xs">
                <label htmlFor="editCustomerMobile" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Mobile Number:</label>
                <input
                  type="tel"
                  id="editCustomerMobile"
                  value={editCustomerMobile}
                  onChange={(e) => setEditCustomerMobile(e.target.value)}
                  maxLength="10"
                  pattern="[0-9]{10}"
                  className={`block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                  required
                />
              </div>
              <div className="flex justify-end space-x-4 mt-8">
                <button
                  type="button"
                  onClick={() => setIsEditingCustomer(false)}
                  className={`px-6 py-3 rounded-full font-semibold transition-colors transition-all duration-300 ease-in-out transform hover:scale-105
                    ${isDarkMode ? 'border border-gray-600 text-gray-300 hover:bg-zinc-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-8 py-3 bg-gradient-to-r from-teal-600 to-cyan-700 text-white font-bold rounded-full shadow-lg hover:from-teal-700 hover:to-cyan-800 transition-all duration-300 ease-in-out transform hover:scale-105"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Alert/Confirmation Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`rounded-xl shadow-2xl p-8 w-full max-w-sm relative border transform scale-95 animate-scale-in transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border-blue-700' : 'bg-white border-blue-300'}`}>
            <h2 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-700'}`}>{modalTitle}</h2>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{modalMessage}</p>
            <div className="flex justify-end space-x-4">
              {modalType === 'confirm' && (
                <>
                  <button
                    onClick={closeModal}
                    className={`px-6 py-3 rounded-full font-semibold transition-colors transition-all duration-300 ease-in-out transform hover:scale-105
                      ${isDarkMode ? 'border border-gray-600 text-gray-300 hover:bg-zinc-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (modalOnConfirm) {
                        modalOnConfirm();
                      }
                      closeModal();
                    }}
                    className="px-8 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold rounded-full shadow-lg hover:from-red-600 hover:to-rose-700 transition-all duration-300 ease-in-out"
                  >
                    Confirm
                  </button>
                </>
              )}
              {modalType === 'alert' && (
                <button
                  onClick={closeModal}
                  className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-700 text-white rounded-md hover:from-blue-600 hover:to-blue-800 transition-all duration-150 ease-in-out transform hover:scale-105"
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Password Protected) */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`rounded-xl shadow-2xl p-8 w-full max-w-sm relative border transform scale-95 animate-scale-in transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border-rose-700' : 'bg-white border-red-300'}`}>
            <h2 className="flex justify-center text-xl font-bold mb-4">
			<div className="flex items-center flex-wrap gap-1 text-center">
			<svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 flex-shrink-0 ${isDarkMode ? 'text-rose-400' : 'text-red-700'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
			</svg>
			<span className={`${isDarkMode ? 'text-rose-400' : 'text-red-700'}`}>Confirm Deletion for</span>
			<span className={`${isDarkMode ? 'text-cyan-400' : 'text-blue-600'}`}>{deleteEntryName}</span>
			</div>
			</h2>
            <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Please enter the admin password to confirm deletion of this entry.
            </p>
            <input
              type="password"
              placeholder="Admin Password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className={`mt-1 block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
            />
            {deletePasswordError && (
              <p className="text-red-500 text-center text-sm mt-2">{deletePasswordError}</p>
            )}
            <div className="flex justify-end space-x-4 mt-6">
              <button
                onClick={() => setShowDeleteConfirmModal(false)}
                className={`px-6 py-3 rounded-full font-semibold transition-colors transform hover:scale-105 transition-all duration-300 ease-in-out transform hover:scale-105
                  ${isDarkMode ? 'border border-gray-600 text-gray-300 hover:bg-zinc-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteEntry}
                className="px-8 py-3 bg-gradient-to-r from-red-600 to-rose-700 text-white font-bold rounded-full shadow-lg hover:from-red-700 hover:to-rose-800 transition-all duration-300 hover:scale-105 ease-in-out"
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW: Delete Customer Confirmation Modal */}
      {showDeleteCustomerConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`rounded-xl shadow-2xl p-8 w-full max-w-sm relative border transform scale-95 animate-scale-in transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border-rose-700' : 'bg-white border-red-300'}`}>
            <h2 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-rose-400' : 'text-red-700'}`}>Confirm Customer Deletion</h2>
            <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Are you sure you want to delete the customer "<span className="font-bold">{deleteCustomerName}</span>"?
              This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-4 mt-6">
              <button
                onClick={() => setShowDeleteCustomerConfirmModal(false)}
                className={`px-6 py-3 rounded-full font-semibold transition-colors transition-all duration-300 ease-in-out transform hover:scale-105
                  ${isDarkMode ? 'border border-gray-600 text-gray-300 hover:bg-zinc-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteCustomer}
                className="px-8 py-3 bg-gradient-to-r from-red-600 to-rose-700 text-white font-bold rounded-full shadow-lg hover:from-red-700 hover:to-rose-800 transition-all duration-300 ease-in-out"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW: Time-Up Notification Pop-up */}
      {showTimeUpNotification && notifiedEntry && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 p-6 rounded-xl shadow-2xl transition-all duration-500 animate-slide-in-top
          ${isDarkMode ? 'bg-red-800 border border-red-700 text-white' : 'bg-red-300 border border-red-400 text-red-900'}`}>
          <h3 className="text-2xl font-extrabold mb-2 text-center">⏰ Time's Up! ⏰</h3>
          <p className="text-lg mb-1 text-center">
            Session for <span className="font-bold">{notifiedEntry.name}</span> has ended.
          </p>
          <p className="text-xl font-bold text-center mb-4">
            Total Bill: <span className={`${isDarkMode ? 'text-green-300' : 'text-green-700'}`}>₹{notifiedEntry.totalBill?.toFixed(2)}</span>
          </p>
          <div className="flex justify-center">
            <button
              onClick={handleDismissTimeUpNotification}
              className={`px-6 py-3 rounded-full font-semibold transition-colors duration-200 ease-in-out
                ${isDarkMode ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-red-500 hover:bg-red-600 text-white'} shadow-md`}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* NEW: Advance Booking Reminder Pop-up */}
      {showAdvanceBookingReminder && currentBookingReminder && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 p-6 rounded-xl shadow-2xl transition-all duration-500 animate-slide-in-right
          ${isDarkMode ? 'bg-indigo-800 border border-indigo-700 text-white' : 'bg-blue-300 border border-blue-400 text-blue-900'}`}>
          <h3 className="text-2xl font-extrabold mb-2 text-center">🔔 Upcoming Booking Reminder! 🔔</h3>
          <p className="text-lg mb-1 text-center">
            A slot is booked for <span className="font-bold">{currentBookingReminder.name}</span> with{' '}
            <span className="font-bold">{currentBookingReminder.numPlayers} {currentBookingReminder.numPlayers > 1 ? 'Players' : 'Person'}</span>.
          </p>
          <p className="text-xl font-bold text-center mb-4">
            Time Slot: <span className={`${isDarkMode ? 'text-teal-300' : 'text-indigo-700'}`}>{currentBookingReminder.timeSlot}</span>
          </p>
          <div className="flex justify-center">
            <button
              onClick={handleDismissAdvanceBookingReminder}
              className={`px-6 py-3 rounded-full font-semibold transition-colors duration-200 ease-in-out
                ${isDarkMode ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'} shadow-md`}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* NEW: Edit Password Prompt Modal */}
      {showEditPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`rounded-xl shadow-2xl p-8 w-full max-w-sm relative border transform scale-95 animate-scale-in transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border-indigo-700' : 'bg-white border-blue-300'}`}>
            <h2 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-indigo-400' : 'text-blue-700'}`}>Admin Password Required</h2>
            <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              This entry's session ended more than 30 minutes ago. Please enter the admin password to edit.
            </p>
            <input
              type="password"
              placeholder="Enter Admin Password"
              value={editAttemptPassword}
              onChange={(e) => setEditAttemptPassword(e.target.value)}
              className={`mt-1 block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
            />
            {editAttemptPasswordError && (
              <p className="text-red-500 text-center text-sm mt-2">{editAttemptPasswordError}</p>
            )}
            <div className="flex justify-end space-x-4 mt-6">
              <button
                onClick={() => {
                  setShowEditPasswordModal(false);
                  setEntryToEditAfterPassword(null);
                }}
                className={`px-6 py-3 rounded-full font-semibold transition-colors transition-all duration-300 ease-in-out transform hover:scale-105
                  ${isDarkMode ? 'border border-gray-600 text-gray-300 hover:bg-zinc-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleVerifyEditPassword}
                className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-700 text-white font-bold rounded-full shadow-lg hover:from-blue-700 hover:to-purple-800 transition-all duration-300 ease-in-out hover:scale-105"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Verifying...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW: Change Admin Password Modal */}
      {showChangePasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`rounded-xl shadow-2xl p-8 w-full max-w-sm relative border transform scale-95 animate-scale-in transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border-teal-700' : 'bg-white border-green-300'}`}>
            <h2 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-teal-400' : 'text-green-700'}`}>Change Admin Password</h2>
            <div className="flex flex-col gap-4 mb-4">
              <div>
                <label htmlFor="oldPassword" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Current Password:</label>
                <input
                  type="password"
                  id="oldPassword"
                  value={oldPasswordInput}
                  onChange={(e) => setNewOldPasswordInput(e.target.value)}
                  className={`mt-1 block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                />
              </div>
              <div>
                <label htmlFor="newPassword" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>New Password:</label>
                <input
                  type="password"
                  id="newPassword"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  className={`mt-1 block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                />
              </div>
              <div>
                <label htmlFor="confirmNewPassword" className={`block text-sm font-medium mb-1 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Confirm New Password:</label>
                <input
                  type="password"
                  id="confirmNewPassword"
                  value={confirmNewPasswordInput}
                  onChange={(e) => setConfirmNewPasswordInput(e.target.value)}
                  className={`mt-1 block w-full rounded-lg shadow-sm p-3 input-focus-ring text-center transition-colors duration-500
                    ${isDarkMode ? 'border-zinc-600 bg-zinc-700 text-gray-200' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 shadow-lg shadow-blue-200/50'}`}
                />
              </div>
            </div>
            {changePasswordError && (
              <p className="text-red-500 text-center text-sm mb-4">{changePasswordError}</p>
            )}
            <div className="flex justify-end space-x-4 mt-6">
              <button
                onClick={() => setShowChangePasswordModal(false)}
                className={`px-6 py-3 rounded-full font-semibold transition-colors transition-all duration-300 ease-in-out transform hover:scale-105
                  ${isDarkMode ? 'border border-gray-600 text-gray-300 hover:bg-zinc-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleChangeAdminPassword}
                className="px-8 py-3 bg-gradient-to-r from-teal-600 to-cyan-700 text-white font-bold rounded-full shadow-lg hover:from-teal-700 hover:to-cyan-800 transition-all duration-300 ease-in-out hover:scale-105"
              >
                Save Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Beverage Details Modal */}
      {showBeverageDetailsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`rounded-xl shadow-2xl p-8 w-full max-w-sm relative border transform scale-95 animate-scale-in transition-colors duration-500 max-h-[90vh] overflow-y-auto
            ${isDarkMode ? 'bg-zinc-800 border-blue-700' : 'bg-white border-blue-300'}`}>
            <h2 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-700'}`}>
              Food & Beverages for <span className={`${isDarkMode ? 'text-cyan-400' : 'text-indigo-600'}`}>{selectedEntryNameForBeverages}</span>
            </h2>
            {Object.keys(beveragesForDetails).length === 0 ? (
              <p className={`${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>No food & beverages found for this entry.</p>
            ) : (
              <ul className={`list-disc list-inside mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {Object.entries(beveragesForDetails)
                  .map(([bevKey, qty]) => {
                    let nameToDisplay;
                    let pricePerUnit; // Store price per unit for sorting

                    // First, check if it's a fixed beverage
                    if (SORTED_FIXED_BEVERAGE_PRICES[bevKey] !== undefined) {
                      nameToDisplay = bevKey;
                      pricePerUnit = SORTED_FIXED_BEVERAGE_PRICES[bevKey];
                    } else {
                      // Then, check dynamically added beverages
                      const bev = beverages.find(b => b.id === bevKey);
                      nameToDisplay = bev ? bev.name : 'Unknown Beverage';
                      pricePerUnit = bev ? bev.price : 0;
                    }
                    return { bevKey, qty, nameToDisplay, pricePerUnit };
                  })
                  .sort((a, b) => a.pricePerUnit - b.pricePerUnit) // Sort by price per unit
                  .map(({ bevKey, qty, nameToDisplay, pricePerUnit }) => (
                    <li key={bevKey} className="mb-1">
                      {nameToDisplay} (x{qty}) - ₹{(pricePerUnit * qty)?.toFixed(2)}
                    </li>
                  ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button
                onClick={handleCloseBeverageDetailsModal}
                className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-700 text-white rounded-md hover:from-blue-600 hover:to-blue-800 transition-all duration-150 ease-in-out transform hover:scale-105"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

{/* Column Visibility Modal */}
      {showColumnVisibilityModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`rounded-xl shadow-2xl p-8 w-full max-w-md relative border transform scale-95 animate-scale-in transition-colors duration-500 max-h-[90vh] overflow-y-auto
            ${isDarkMode ? 'bg-zinc-800 border-purple-700' : 'bg-white border-blue-300'}`}>
            <h2 className={`text-2xl font-bold mb-6 border-b-2 pb-4 text-center ${isDarkMode ? 'text-blue-400' : 'text-blue-700'}`}>Manage Columns</h2>
            <div className="grid grid-cols-2 gap-4">
              {columnHeaders.filter(col => col.key !== 'actions').map(col => ( // Exclude 'actions' from customization
                <label key={col.key} className={`inline-flex items-center cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input
                    type="checkbox"
                    className="form-checkbox h-5 w-5 text-blue-600 rounded-md"
                    checked={columnVisibility[col.key]}
                    onChange={() => handleColumnToggle(col.key)}
                  />
                  <span className="ml-2">{col.label}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end mt-8">
              <button
                onClick={() => setShowColumnVisibilityModal(false)}
                className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-700 text-white rounded-md hover:from-blue-600 hover:to-blue-800 transition-all duration-150 ease-in-out transform hover:scale-105"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

{/* NEW: Notes Modal */}
{showNotesModal && currentEntryForNotes && (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
        <div className={`rounded-xl shadow-2xl p-8 w-full max-w-lg relative border transform scale-95 animate-scale-in transition-colors duration-500
            ${isDarkMode ? 'bg-zinc-800 border-yellow-700' : 'bg-white border-amber-300'}`}>
            
            <div className="flex justify-between items-center pb-3 border-b-2 mb-4">
                <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-yellow-400 border-yellow-600' : 'text-amber-700 border-amber-300'}`}>
                    Notes for {currentEntryForNotes.name}
                </h2>
                <button
                    onClick={() => setShowNotesModal(false)}
                    className={`p-2 rounded-full ${isDarkMode ? 'text-gray-400 hover:bg-zinc-700' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
            
            <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Enter notes here (e.g., remaining balance, special requests)..."
                rows="5"
                className={`w-full p-3 rounded-lg shadow-inner input-focus-ring transition-colors duration-500
                    ${isDarkMode ? 'bg-zinc-700 border-zinc-600 text-gray-200' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
            />
            
            <div className="flex justify-between items-center mt-6">
                {/* Delete button only shows if a note already exists */}
                {currentEntryForNotes.notes && (
                    <button
                        onClick={handleDeleteNote}
                        className="px-6 py-3 bg-gradient-to-r from-red-600 to-rose-700 text-white font-bold rounded-full shadow-lg hover:from-red-700 hover:to-rose-800 transition-all duration-300 ease-in-out transform hover:scale-105"
                    >
                        Delete Note
                    </button>
                )}

                <div className="flex space-x-4 ml-auto">
					<button
                        onClick={() => setShowNotesModal(false)}
                        className={`px-6 py-3 rounded-full font-semibold transition-colors transition-all duration-300 ease-in-out transform hover:scale-105
                            ${isDarkMode ? 'border border-gray-600 text-gray-300 hover:bg-zinc-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSaveNote}
                        className="px-6 py-3 bg-gradient-to-r from-green-600 to-teal-700 text-white font-bold rounded-full shadow-lg hover:from-green-700 hover:to-teal-800 transition-all duration-300 ease-in-out transform hover:scale-105"
                    >
                        Save Note
                    </button>
                </div>
            </div>
        </div>
    </div>
)}


{/* NEW: Floating Total Selected Bill Box */}
    {selectedEntryIds.size > 0 && (
        <div 
            key={totalBillKey} // Key to trigger animation on value change
            className={`fixed bottom-4 right-14 z-40 p-2 rounded-lg shadow-2xl transition-all duration-500 flex items-center justify-center space-x-3
              ${isDarkMode 
                ? 'bg-gradient-to-r from-yellow-500 to-amber-600 text-white shadow-yellow-500/10 animate-pulse-border' 
                : 'bg-gradient-to-r from-yellow-500 to-amber-600 text-white shadow-yello-500/10 animate-pulse-border'}
              animate-subtle-bounce
            `}
        >
            {/* Money Bag Icon */}
                <div>
                <h3 className="text-sm font-bold" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}>Selected Entries Total:</h3>
                <p className="text-3xl font-extrabold text-center drop-shadow-lg" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}>
                    ₹{totalSelectedBill.toFixed(2)}
                </p>
            </div>
        </div>
    )}

    </div>
  );
};

export default App;
