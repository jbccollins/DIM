import { startFarming } from 'app/farming/actions';
import { interruptFarming, resumeFarming } from 'app/farming/basic-actions';
import { t } from 'app/i18next-t';
import { InventoryBuckets } from 'app/inventory/inventory-buckets';
import { bucketsSelector, storesSelector } from 'app/inventory/selectors';
import { getAllItems, getArtifactBonus } from 'app/inventory/stores-helpers';
import { editLoadout } from 'app/loadout/LoadoutDrawer';
import { ItemFilter } from 'app/search/filter-types';
import { RootState, ThunkDispatchProp } from 'app/store/types';
import { itemCanBeInLoadout } from 'app/utils/item-utils';
import { DestinyClass } from 'bungie-api-ts/destiny2';
import helmetIcon from 'destiny-icons/armor_types/helmet.svg';
import xpIcon from 'images/xpIcon.svg';
import _ from 'lodash';
import React from 'react';
import { connect } from 'react-redux';
import { createSelector } from 'reselect';
import PressTip from '../dim-ui/PressTip';
import { queueAction } from '../inventory/action-queue';
import { DimStore } from '../inventory/store-types';
import { showNotification } from '../notifications/notifications';
import { searchFilterSelector } from '../search/search-filter';
import {
  addIcon,
  AppIcon,
  banIcon,
  deleteIcon,
  editIcon,
  engramIcon,
  faRandom,
  globeIcon,
  hunterIcon,
  levellingIcon,
  powerActionIcon,
  powerIndicatorIcon,
  searchIcon,
  sendIcon,
  titanIcon,
  undoIcon,
  warlockIcon,
} from '../shell/icons';
import { querySelector } from '../shell/reducer';
import { deleteLoadout } from './actions';
import {
  itemLevelingLoadout,
  maxLightItemSet,
  maxLightLoadout,
  randomLoadout,
  searchLoadout,
} from './auto-loadouts';
import { applyLoadout } from './loadout-apply';
import './loadout-popup.scss';
import { Loadout } from './loadout-types';
import { convertToLoadoutItem, getLight, newLoadout } from './loadout-utils';
import { fromEquippedTypes } from './LoadoutDrawerContents';
import {
  makeRoomForPostmaster,
  pullablePostmasterItems,
  pullFromPostmaster,
  totalPostmasterItems,
} from './postmaster';
import { loadoutsSelector, previousLoadoutSelector } from './reducer';

const loadoutIcon = {
  [DestinyClass.Unknown]: globeIcon,
  [DestinyClass.Hunter]: hunterIcon,
  [DestinyClass.Warlock]: warlockIcon,
  [DestinyClass.Titan]: titanIcon,
};

interface ProvidedProps {
  dimStore: DimStore;
  onClick(e): void;
}

interface StoreProps {
  previousLoadout?: Loadout;
  loadouts: Loadout[];
  query: string;
  classTypeId: DestinyClass;
  stores: DimStore[];
  hasClassified: boolean;
  buckets: InventoryBuckets;
  searchFilter: ItemFilter;
}

type Props = ProvidedProps & StoreProps & ThunkDispatchProp;

function mapStateToProps() {
  /** Does the user have an classified items? */
  const hasClassifiedSelector = createSelector(storesSelector, (stores) =>
    getAllItems(stores).some(
      (i) =>
        i.classified &&
        (i.location.sort === 'Weapons' || i.location.sort === 'Armor' || i.type === 'Ghost')
    )
  );

  const loadoutsForPlatform = createSelector(
    loadoutsSelector,
    (_, { dimStore }: ProvidedProps) => dimStore,
    (loadouts, dimStore) =>
      _.sortBy(
        loadouts.filter(
          (loadout) =>
            dimStore.classType === DestinyClass.Unknown ||
            loadout.classType === DestinyClass.Unknown ||
            loadout.classType === dimStore.classType
        ),
        (l) => l.name
      )
  );

  return (state: RootState, ownProps: ProvidedProps): StoreProps => {
    const { dimStore } = ownProps;

    return {
      previousLoadout: previousLoadoutSelector(state, ownProps.dimStore.id),
      loadouts: loadoutsForPlatform(state, ownProps),
      query: querySelector(state),
      searchFilter: searchFilterSelector(state),
      classTypeId: dimStore.classType,
      stores: storesSelector(state),
      buckets: bucketsSelector(state)!,
      hasClassified: hasClassifiedSelector(state),
    };
  };
}

function LoadoutPopup({
  dimStore,
  stores,
  previousLoadout,
  loadouts,
  query,
  onClick,
  hasClassified,
  classTypeId,
  searchFilter,
  buckets,
  dispatch,
}: Props) {
  // For the most part we don't need to memoize this - this menu is destroyed when closed
  const maxLight = getLight(dimStore, maxLightItemSet(stores, dimStore).equippable);
  const artifactLight = getArtifactBonus(dimStore);

  const numPostmasterItems = dimStore.isDestiny2()
    ? pullablePostmasterItems(dimStore, stores).length
    : 0;
  const numPostmasterItemsTotal = totalPostmasterItems(dimStore);

  const makeNewLoadout = () => {
    editLoadout(newLoadout('', []), { isNew: true });
  };

  const newLoadoutFromEquipped = () => {
    const items = dimStore.items.filter(
      (item) => item.equipped && itemCanBeInLoadout(item) && fromEquippedTypes.includes(item.type)
    );
    const loadout = newLoadout(
      '',
      items.map((i) => convertToLoadoutItem(i, true))
    );
    loadout.classType = classTypeId;
    editLoadout(loadout, { isNew: true });
  };

  const deleteExistingLoadout = async (loadout: Loadout) => {
    if (confirm(t('Loadouts.ConfirmDelete', { name: loadout.name }))) {
      dispatch(deleteLoadout(loadout.id));
    }
  };

  // TODO: move all these fancy loadouts to a new service

  const onApplyLoadout = async (loadout: Loadout, e, filterToEquipped = false) => {
    e.preventDefault();

    if (filterToEquipped) {
      loadout = filterLoadoutToEquipped(loadout);
    }

    dispatch(interruptFarming());
    try {
      return await dispatch(applyLoadout(dimStore, loadout, true));
    } finally {
      dispatch(resumeFarming());
    }
  };

  // A dynamic loadout set up to level weapons and armor
  const makeItemLevelingLoadout = (e) => {
    const loadout = itemLevelingLoadout(stores, dimStore);
    onApplyLoadout(loadout, e);
  };

  // Apply a loadout that's dynamically calculated to maximize Light level (preferring not to change currently-equipped items)
  const makeMaxLightLoadout = (e) => {
    const loadout = maxLightLoadout(stores, dimStore);
    onApplyLoadout(loadout, e);
  };

  // A dynamic loadout set up to level weapons and armor
  const gatherEngramsLoadout = (e, options: { exotics: boolean } = { exotics: false }) => {
    let loadout;
    try {
      loadout = gatherEngramsLoadout(stores, options);
    } catch (e) {
      showNotification({ type: 'warning', title: t('Loadouts.GatherEngrams'), body: e.message });
      return;
    }
    onApplyLoadout(loadout, e);
  };

  const applyRandomLoadout = (e, weaponsOnly = false) => {
    if (
      !window.confirm(
        weaponsOnly
          ? t('Loadouts.RandomizeWeapons')
          : query.length > 0
          ? t('Loadouts.RandomizeSearchPrompt', { query })
          : t('Loadouts.RandomizePrompt')
      )
    ) {
      e.preventDefault();
      return;
    }
    try {
      const loadout = randomLoadout(
        stores,
        weaponsOnly ? (i) => i.bucket?.sort === 'Weapons' && searchFilter(i) : searchFilter
      );
      if (loadout) {
        onApplyLoadout(loadout, e);
      }
    } catch (e) {
      showNotification({ type: 'warning', title: t('Loadouts.Random'), body: e.message });
      return;
    }
  };

  // Move items matching the current search. Max 9 per type.
  const applySearchLoadout = (e) => {
    const loadout = searchLoadout(stores, dimStore, searchFilter);
    onApplyLoadout(loadout, e);
  };

  const doMakeRoomForPostmaster = () =>
    queueAction(() => dispatch(makeRoomForPostmaster(dimStore, buckets)));

  const doPullFromPostmaster = () => queueAction(() => dispatch(pullFromPostmaster(dimStore)));

  const onStartFarming = () => {
    dispatch(startFarming(dimStore.id));
  };

  return (
    <div className="loadout-popup-content" onClick={onClick} role="menu">
      <ul className="loadout-list">
        <li className="loadout-set">
          <span onClick={makeNewLoadout}>
            <AppIcon icon={addIcon} />
            <span>{t('Loadouts.Create')}</span>
          </span>
          <span onClick={newLoadoutFromEquipped}>{t('Loadouts.FromEquipped')}</span>
        </li>

        {query.length > 0 && (
          <li className="loadout-set">
            <span onClick={applySearchLoadout}>
              <AppIcon icon={searchIcon} />
              <span>{t('Loadouts.ApplySearch', { query })}</span>
            </span>
          </li>
        )}

        {!dimStore.isVault && (
          <>
            <li className="loadout-set">
              <span onClick={makeMaxLightLoadout}>
                <PressTip tooltip={hasClassified ? t('Loadouts.Classified') : ''}>
                  <span className="light">
                    {dimStore.destinyVersion === 1 ? (
                      <>
                        <AppIcon icon={powerIndicatorIcon} />
                        {Math.floor(maxLight * 10) / 10}
                      </>
                    ) : (
                      <>
                        <img className="yellowInlineSvg" src={helmetIcon} />
                        {Math.floor(maxLight)}
                        {' + '}
                        <img className="yellowInlineSvg" src={xpIcon} />
                        {artifactLight}
                      </>
                    )}

                    {hasClassified && <sup>*</sup>}
                  </span>
                </PressTip>
                <AppIcon icon={powerActionIcon} />
                <span>
                  {dimStore.destinyVersion === 2
                    ? t('Loadouts.MaximizePower')
                    : t('Loadouts.MaximizeLight')}
                </span>
              </span>
            </li>

            {dimStore.isDestiny1() && (
              <>
                <li className="loadout-set">
                  <span onClick={makeItemLevelingLoadout}>
                    <AppIcon icon={levellingIcon} />
                    <span>{t('Loadouts.ItemLeveling')}</span>
                  </span>
                </li>

                {numPostmasterItemsTotal > 0 && (
                  <li className="loadout-set">
                    <span onClick={doMakeRoomForPostmaster}>
                      <AppIcon icon={sendIcon} />
                      <span>{t('Loadouts.MakeRoom')}</span>
                    </span>
                  </li>
                )}
              </>
            )}

            {dimStore.isDestiny2() && numPostmasterItems > 0 && (
              <li className="loadout-set">
                <span onClick={doPullFromPostmaster}>
                  <AppIcon icon={sendIcon} />
                  <span className="badge">{numPostmasterItems}</span>{' '}
                  <span>{t('Loadouts.PullFromPostmaster')}</span>
                </span>
                <span onClick={doMakeRoomForPostmaster}>{t('Loadouts.PullMakeSpace')}</span>
              </li>
            )}
            {dimStore.isDestiny2() && numPostmasterItems === 0 && numPostmasterItemsTotal > 0 && (
              <li className="loadout-set">
                <span onClick={doMakeRoomForPostmaster}>
                  <AppIcon icon={sendIcon} />
                  <span>{t('Loadouts.MakeRoom')}</span>
                </span>
              </li>
            )}
          </>
        )}

        {dimStore.isDestiny1() && (
          <li className="loadout-set">
            <span onClick={(e) => gatherEngramsLoadout(e, { exotics: true })}>
              <AppIcon icon={engramIcon} />
              <span>{t('Loadouts.GatherEngrams')}</span>
            </span>
            <span onClick={(e) => gatherEngramsLoadout(e, { exotics: false })}>
              <AppIcon icon={banIcon} /> <span>{t('Loadouts.GatherEngramsExceptExotics')}</span>
            </span>
          </li>
        )}

        <li className="loadout-set">
          <span onClick={applyRandomLoadout}>
            <AppIcon icon={faRandom} />
            <span>
              {query.length > 0 ? t('Loadouts.RandomizeSearch') : t('Loadouts.Randomize')}
            </span>
          </span>
          {query.length === 0 && (
            <span onClick={(e) => applyRandomLoadout(e, true)}>
              <span>{t('Loadouts.WeaponsOnly')}</span>
            </span>
          )}
        </li>

        {!dimStore.isVault && (
          <li className="loadout-set">
            <span onClick={onStartFarming}>
              <AppIcon icon={engramIcon} />
              <span>{t('FarmingMode.FarmingMode')}</span>
            </span>
          </li>
        )}

        {previousLoadout && (
          <li className="loadout-set">
            <span
              title={previousLoadout.name}
              onClick={(e) => onApplyLoadout(previousLoadout, e, true)}
            >
              <AppIcon icon={undoIcon} />
              {previousLoadout.name}
            </span>
            <span onClick={(e) => onApplyLoadout(previousLoadout, e)}>
              <span>{t('Loadouts.RestoreAllItems')}</span>
            </span>
          </li>
        )}

        {loadouts.map((loadout) => (
          <li key={loadout.id} className="loadout-set">
            <span title={loadout.name} onClick={(e) => onApplyLoadout(loadout, e)}>
              <AppIcon className="loadout-type-icon" icon={loadoutIcon[loadout.classType]} />
              {loadout.name}
            </span>
            <span
              className="delete"
              title={t('Loadouts.Delete')}
              onClick={() => deleteExistingLoadout(loadout)}
            >
              <AppIcon icon={deleteIcon} />
            </span>
            <span title={t('Loadouts.Edit')} onClick={() => editLoadout(loadout, { isNew: false })}>
              <AppIcon icon={editIcon} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default connect<StoreProps>(mapStateToProps)(LoadoutPopup);

/**
 * Filter a loadout down to only the equipped items in the loadout.
 */
export function filterLoadoutToEquipped(loadout: Loadout) {
  return {
    ...loadout,
    items: loadout.items.filter((i) => i.equipped),
  };
}
