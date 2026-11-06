import { createContext, useContext } from 'react';

// App-wide actions (queue, favourites, playlists) so lists don't need prop drilling.
export const ActionsContext = createContext(null);
export const useActions = () => useContext(ActionsContext);
