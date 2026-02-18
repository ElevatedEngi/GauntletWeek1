import { create } from 'zustand';
import { User } from '@whiteboard/shared-types';
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// 8 distinct cursor colors for user selection
export const CURSOR_COLORS = [
  { name: 'Red', value: '#EF4444' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Yellow', value: '#EAB308' },
  { name: 'Green', value: '#22C55E' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Purple', value: '#A855F7' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Teal', value: '#14B8A6' },
];

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  cursorColor: string;
  firebaseUser: FirebaseUser | null;
  setUser: (user: User | null) => void;
  setFirebaseUser: (firebaseUser: FirebaseUser | null) => void;
  setLoading: (loading: boolean) => void;
  setCursorColor: (color: string) => void;
  initAuth: () => void;
  logout: () => Promise<void>;
}

const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  firebaseUser: null,
  isAuthenticated: false,
  isLoading: true,
  cursorColor: CURSOR_COLORS[0].value, // Default to red

  setUser: (user) => {
    // Assign a random color from the palette when user logs in
    const randomColor = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)].value;
    const savedColor = localStorage.getItem('cursor_color');
    set({
      user,
      isAuthenticated: !!user,
      cursorColor: savedColor || randomColor
    });
  },

  setFirebaseUser: (firebaseUser) => {
    set({ firebaseUser });
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setCursorColor: (color) => {
    localStorage.setItem('cursor_color', color);
    set({ cursorColor: color });

    // Update cursor color in Firestore user profile
    const { firebaseUser } = get();
    if (firebaseUser) {
      const userRef = doc(db, 'users', firebaseUser.uid);
      setDoc(userRef, { preferences: { cursorColor: color } }, { merge: true }).catch((error) => {
        console.error('Failed to update cursor color in Firestore:', error);
      });
    }
  },

  initAuth: () => {
    // Set up Firebase auth state listener
    onAuthStateChanged(auth, async (firebaseUser) => {
      set({ isLoading: true });

      if (firebaseUser) {
        // User is signed in
        set({ firebaseUser });

        // Get or create user profile in Firestore
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        let cursorColor = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)].value;
        const savedColor = localStorage.getItem('cursor_color');

        if (userSnap.exists()) {
          // User exists, get their cursor color preference
          const userData = userSnap.data();
          cursorColor = userData.preferences?.cursorColor || savedColor || cursorColor;
        } else {
          // New user, create profile
          cursorColor = savedColor || cursorColor;
          await setDoc(userRef, {
            email: firebaseUser.email,
            name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Anonymous',
            avatar: firebaseUser.photoURL,
            createdAt: Date.now(),
            preferences: { cursorColor }
          });
        }

        // Set user in store
        const user: User = {
          id: firebaseUser.uid,
          email: firebaseUser.email || '',
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Anonymous',
          avatar: firebaseUser.photoURL || undefined,
          createdAt: userSnap.exists() ? userSnap.data().createdAt : Date.now(),
        };

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          cursorColor
        });

        // Save cursor color to localStorage
        localStorage.setItem('cursor_color', cursorColor);
      } else {
        // User is signed out
        set({
          user: null,
          firebaseUser: null,
          isAuthenticated: false,
          isLoading: false
        });
      }
    });
  },

  logout: async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('cursor_color');
      set({ user: null, firebaseUser: null, isAuthenticated: false });
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  },
}));

export default useAuthStore;
