import React, {useCallback, useMemo, useRef, useState} from 'react';
import {InteractionManager, View} from 'react-native';
import type {TextInput} from 'react-native';
import type {OnyxEntry} from 'react-native-onyx';
import {withOnyx} from 'react-native-onyx';
import type {ValueOf} from 'type-fest';
import Badge from '@components/Badge';
import FullPageNotFoundView from '@components/BlockingViews/FullPageNotFoundView';
import Button from '@components/Button';
import ButtonWithDropdownMenu from '@components/ButtonWithDropdownMenu';
import type {DropdownOption, WorkspaceMemberBulkActionType} from '@components/ButtonWithDropdownMenu/types';
import ConfirmModal from '@components/ConfirmModal';
import HeaderWithBackButton from '@components/HeaderWithBackButton';
import * as Expensicons from '@components/Icon/Expensicons';
import * as Illustrations from '@components/Icon/Illustrations';
import ScreenWrapper from '@components/ScreenWrapper';
import SelectionList from '@components/SelectionList';
import TableListItem from '@components/SelectionList/TableListItem';
import type {ListItem, SelectionListHandle} from '@components/SelectionList/types';
import Text from '@components/Text';
import useLocalize from '@hooks/useLocalize';
import useStyleUtils from '@hooks/useStyleUtils';
import useThemeStyles from '@hooks/useThemeStyles';
import useWindowDimensions from '@hooks/useWindowDimensions';
import * as Report from '@libs/actions/Report';
import Log from '@libs/Log';
import Navigation from '@libs/Navigation/Navigation';
import * as PersonalDetailsUtils from '@libs/PersonalDetailsUtils';
import * as ReportUtils from '@libs/ReportUtils';
import * as UserUtils from '@libs/UserUtils';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import type {PersonalDetailsList, Session} from '@src/types/onyx';
import type {WithReportOrNotFoundProps} from './home/report/withReportOrNotFound';
import withReportOrNotFound from './home/report/withReportOrNotFound';

type ReportParticipantsPageOnyxProps = {
    /** Personal details of all the users */
    personalDetails: OnyxEntry<PersonalDetailsList>;

    /** Session info for the currently logged in user. */
    session: OnyxEntry<Session>;
};

type ReportParticipantsPageProps = ReportParticipantsPageOnyxProps & WithReportOrNotFoundProps;

type MemberOption = Omit<ListItem, 'accountID'> & {accountID: number};

function ReportParticipantsPage({report, personalDetails, session}: ReportParticipantsPageProps) {
    const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
    const [removeMembersConfirmModalVisible, setRemoveMembersConfirmModalVisible] = useState(false);
    const {translate, formatPhoneNumber} = useLocalize();
    const styles = useThemeStyles();
    const {isSmallScreenWidth} = useWindowDimensions();
    const StyleUtils = useStyleUtils();
    const selectionListRef = useRef<SelectionListHandle>(null);
    const textInputRef = useRef<TextInput>(null);
    const currentUserAccountID = Number(session?.accountID);
    const isCurrentUserAdmin = ReportUtils.isGroupChatAdmin(report, currentUserAccountID);
    const isGroupChat = useMemo(() => ReportUtils.isGroupChat(report), [report]);

    const getUsers = useCallback((): MemberOption[] => {
        let result: MemberOption[] = [];
        ReportUtils.getParticipantAccountIDs(report.reportID).forEach((accountID) => {
            const role = report.participants?.[accountID].role;
            const details = personalDetails?.[accountID];
            if (!details) {
                Log.hmmm(`[ReportParticipantsPage] no personal details found for Group chat member with accountID: ${accountID}`);
                return;
            }

            const isSelected = selectedMembers.includes(accountID);
            const isAdmin = role === CONST.REPORT.ROLE.ADMIN;
            let roleBadge = null;
            if (isAdmin) {
                roleBadge = (
                    <Badge
                        text={translate('common.admin')}
                        textStyles={[styles.textStrong]}
                        badgeStyles={[styles.justifyContentCenter, styles.badgeSmall]}
                    />
                );
            }

            result.push({
                keyForList: `${accountID}`,
                accountID,
                isSelected,
                isDisabledCheckbox: accountID === currentUserAccountID,
                text: formatPhoneNumber(PersonalDetailsUtils.getDisplayNameOrDefault(details)),
                alternateText: formatPhoneNumber(details?.login ?? ''),
                rightElement: roleBadge,
                icons: [
                    {
                        source: UserUtils.getAvatar(details?.avatar, accountID),
                        name: formatPhoneNumber(details?.login ?? ''),
                        type: CONST.ICON_TYPE_AVATAR,
                        id: accountID,
                    },
                ],
            });
        });

        result = result.sort((a, b) => (a.text ?? '').toLowerCase().localeCompare((b.text ?? '').toLowerCase()));

        return result;
    }, [formatPhoneNumber, personalDetails, report, selectedMembers, currentUserAccountID, translate, styles]);

    const participants = useMemo(() => getUsers(), [getUsers]);

    /**
     * Add user from the selectedMembers list
     */
    const addUser = useCallback((accountID: number) => setSelectedMembers((prevSelected) => [...prevSelected, accountID]), [setSelectedMembers]);

    /**
     * Add or remove all users passed from the selectedEmployees list
     */
    const toggleAllUsers = (memberList: MemberOption[]) => {
        const enabledAccounts = memberList.filter((member) => !member.isDisabled && !member.isDisabledCheckbox);
        const everyoneSelected = enabledAccounts.every((member) => selectedMembers.includes(member.accountID));

        if (everyoneSelected) {
            setSelectedMembers([]);
        } else {
            const everyAccountId = enabledAccounts.map((member) => member.accountID);
            setSelectedMembers(everyAccountId);
        }
    };

    /**
     * Remove user from the selectedMembers list
     */
    const removeUser = useCallback(
        (accountID: number) => {
            setSelectedMembers((prevSelected) => prevSelected.filter((id) => id !== accountID));
        },
        [setSelectedMembers],
    );

    /**
     * Open the modal to invite a user
     */
    const inviteUser = useCallback(() => {
        Navigation.navigate(ROUTES.REPORT_PARTICIPANTS_INVITE.getRoute(report.reportID));
    }, [report]);

    /**
     * Remove selected users from the workspace
     * Please see https://github.com/Expensify/App/blob/main/README.md#Security for more details
     */
    const removeUsers = () => {
        // Remove the admin from the list
        const accountIDsToRemove = selectedMembers.filter((id) => id !== currentUserAccountID);
        Report.removeFromGroupChat(report.reportID, accountIDsToRemove);
        setSelectedMembers([]);
        setRemoveMembersConfirmModalVisible(false);
    };

    const changeUserRole = useCallback((role: ValueOf<typeof CONST.REPORT.ROLE>) => {
        const accountIDsToUpdate = selectedMembers.filter((id) => report.participants?.[id].role !== role);
        Report.updateGroupChatMemberRoles(report.reportID, accountIDsToUpdate, role);
        setSelectedMembers([]);
    }, [report, selectedMembers]);

    /**
     * Toggle user from the selectedMembers list
     */
    const toggleUser = useCallback(
        (accountID: number) => {
            // Add or remove the user if the checkbox is enabled
            if (selectedMembers.includes(accountID)) {
                removeUser(accountID);
            } else {
                addUser(accountID);
            }
        },
        [selectedMembers, addUser, removeUser],
    );

    const headerContent = useMemo(() => {
        if (!isGroupChat) {
            return;
        }

        return <Text style={[styles.pl5, styles.mb4, styles.mt3, styles.textSupporting]}>{translate('groupChat.groupMembersListTitle')}</Text>;
    }, [styles, translate, isGroupChat]);

    const customListHeader = useMemo(() => {
        if (!isGroupChat) {
            return;
        }

        const header = (
            <View style={[styles.flex1, styles.flexRow, styles.justifyContentBetween]}>
                <View>
                    <Text style={[styles.searchInputStyle, styles.ml3]}>{translate('common.member')}</Text>
                </View>
                <View style={[StyleUtils.getMinimumWidth(60)]}>
                    <Text style={[styles.searchInputStyle, styles.textAlignCenter]}>{translate('common.role')}</Text>
                </View>
            </View>
        );

        return <View style={[styles.peopleRow, styles.userSelectNone, styles.ph9, styles.pv3, styles.pb5]}>{header}</View>;
    }, [styles, StyleUtils, translate, isGroupChat]);

    const bulkActionsButtonOptions = useMemo(() => {
        const options: Array<DropdownOption<WorkspaceMemberBulkActionType>> = [
            {
                text: translate('workspace.people.removeMembersTitle'),
                value: CONST.POLICY.MEMBERS_BULK_ACTION_TYPES.REMOVE,
                icon: Expensicons.RemoveMembers,
                onSelected: () => setRemoveMembersConfirmModalVisible(true),
            },
            {
                text: translate('workspace.people.makeAdmin'),
                value: CONST.POLICY.MEMBERS_BULK_ACTION_TYPES.MAKE_ADMIN,
                icon: Expensicons.MakeAdmin,
                onSelected: () => changeUserRole(CONST.REPORT.ROLE.ADMIN),
            },
            {
                text: translate('workspace.people.makeMember'),
                value: CONST.POLICY.MEMBERS_BULK_ACTION_TYPES.MAKE_MEMBER,
                icon: Expensicons.MakeAdmin,
                onSelected: () => changeUserRole(CONST.REPORT.ROLE.MEMBER),
            },
        ];

        return options;
    }, [changeUserRole, translate, setRemoveMembersConfirmModalVisible]);

    const headerButtons = useMemo(() => {
        if (!isGroupChat) {
            return;
        }

        return (
            <View style={styles.w100}>
                {selectedMembers.length > 0 ? (
                    <ButtonWithDropdownMenu<WorkspaceMemberBulkActionType>
                        shouldAlwaysShowDropdownMenu
                        pressOnEnter
                        customText={translate('workspace.common.selected', {selectedNumber: selectedMembers.length})}
                        buttonSize={CONST.DROPDOWN_BUTTON_SIZE.MEDIUM}
                        onPress={() => null}
                        options={bulkActionsButtonOptions}
                        style={[isSmallScreenWidth && styles.flexGrow1]}
                    />
                ) : (
                    <Button
                        medium
                        success
                        onPress={inviteUser}
                        text={translate('workspace.invite.member')}
                        icon={Expensicons.Plus}
                        innerStyles={[isSmallScreenWidth && styles.alignItemsCenter]}
                        style={[isSmallScreenWidth && styles.flexGrow1]}
                    />
                )}
            </View>
        );
    }, [bulkActionsButtonOptions, inviteUser, isSmallScreenWidth, selectedMembers, styles, translate, isGroupChat]);

    /** Opens the member details page */
    const openMemberDetails = useCallback(
        (item: MemberOption) => {
            if (isGroupChat && isCurrentUserAdmin) {
                Navigation.navigate(ROUTES.REPORT_PARTICIPANTS_DETAILS.getRoute(report.reportID, item.accountID));
                return;
            }
            Navigation.navigate(ROUTES.PROFILE.getRoute(item.accountID));
        },
        [report, isCurrentUserAdmin, isGroupChat],
    );
    const headerTitle = useMemo(() => {
        if (
            ReportUtils.isChatRoom(report) ||
            ReportUtils.isPolicyExpenseChat(report) ||
            ReportUtils.isChatThread(report) ||
            ReportUtils.isTaskReport(report) ||
            ReportUtils.isMoneyRequestReport(report)
        ) {
            return translate('common.members');
        }
        if (isGroupChat) {
            return translate('common.everyone');
        }

        return translate('common.details');
    }, [report, translate, isGroupChat]);
    return (
        <ScreenWrapper
            includeSafeAreaPaddingBottom={false}
            style={[styles.defaultModalContainer]}
            testID={ReportParticipantsPage.displayName}
            shouldShowOfflineIndicatorInWideScreen
        >
            <FullPageNotFoundView shouldShow={!report || ReportUtils.isArchivedRoom(report) || ReportUtils.isSelfDM(report)}>
                <HeaderWithBackButton
                    title={headerTitle}
                    subtitle={isGroupChat ? translate('common.members') : ''}
                    icon={isGroupChat ? Illustrations.ReceiptWrangler : undefined}
                    onBackButtonPress={report ? () => Navigation.goBack(ROUTES.REPORT_WITH_ID_DETAILS.getRoute(report.reportID)) : undefined}
                    shouldShowBackButton
                    guidesCallTaskID={CONST.GUIDES_CALL_TASK_IDS.WORKSPACE_MEMBERS}
                    subtitleOnTop={isGroupChat}
                >
                    {!isSmallScreenWidth && headerButtons}
                </HeaderWithBackButton>
                {isSmallScreenWidth && <View style={[styles.pl5, styles.pr5]}>{headerButtons}</View>}
                <ConfirmModal
                    danger
                    title={translate('workspace.people.removeMembersTitle')}
                    isVisible={removeMembersConfirmModalVisible}
                    onConfirm={removeUsers}
                    onCancel={() => setRemoveMembersConfirmModalVisible(false)}
                    prompt={translate('workspace.people.removeMembersPrompt')}
                    confirmText={translate('common.remove')}
                    cancelText={translate('common.cancel')}
                    onModalHide={() => {
                        InteractionManager.runAfterInteractions(() => {
                            if (!textInputRef.current) {
                                return;
                            }
                            textInputRef.current.focus();
                        });
                    }}
                />
                <View style={[styles.w100, styles.flex1]}>
                    <SelectionList
                        ref={selectionListRef}
                        canSelectMultiple={isGroupChat && isCurrentUserAdmin}
                        sections={[{data: participants}]}
                        ListItem={TableListItem}
                        headerContent={headerContent}
                        onSelectRow={openMemberDetails}
                        onCheckboxPress={(item) => toggleUser(item.accountID)}
                        onSelectAll={() => toggleAllUsers(participants)}
                        showScrollIndicator
                        textInputRef={textInputRef}
                        customListHeader={customListHeader}
                        listHeaderWrapperStyle={[styles.ph9, styles.pv3, styles.pb5]}
                    />
                </View>
            </FullPageNotFoundView>
        </ScreenWrapper>
    );
}

ReportParticipantsPage.displayName = 'ReportParticipantsPage';

export default withReportOrNotFound()(
    withOnyx<ReportParticipantsPageProps, ReportParticipantsPageOnyxProps>({
        personalDetails: {
            key: ONYXKEYS.PERSONAL_DETAILS_LIST,
        },
        session: {
            key: ONYXKEYS.SESSION,
        },
    })(ReportParticipantsPage),
);
