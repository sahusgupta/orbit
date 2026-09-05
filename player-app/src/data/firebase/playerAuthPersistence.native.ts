import AsyncStorage from '@react-native-async-storage/async-storage';
import { getReactNativePersistence } from 'firebase/auth';

// Firebase stores only its session material here. Player profile data continues
// to use the separately protected storage adapter.
export const playerAuthPersistence = getReactNativePersistence(AsyncStorage);
